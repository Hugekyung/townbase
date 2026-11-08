import "reflect-metadata";
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { corpusFixtures } from "./evaluation-fixtures";
const r = createRequire(__filename),
  kind = process.env.TOWNBASE_EVAL_CORPUS;
if (
  process.env.TOWNBASE_LIVE_EVALUATION !== "1" ||
  !["ops", "shop"].includes(kind ?? "")
)
  throw Error("Explicit synthetic live benchmark required");
const url = new URL(process.env.DATABASE_URL!);
if (
  url.hostname !== "postgres" ||
  url.pathname !== `/townbase_live_${kind}_test`
)
  throw Error("Dedicated live corpus DB required");
const { PrismaClient } = r("@townbase/database"),
  { NestFactory } = r("@nestjs/core");
const owner = new PrismaClient();
let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>;
(async () => {
  const series = process.env.TOWNBASE_EVAL_SERIES;
  if (!series || !/^[a-z0-9-]+$/.test(series))
    throw Error("Explicit performance series required");
  const evidence = `/data/evidence/${kind}/performance/${series}`;
  await mkdir(`/data/evidence/${kind}/performance`, {
    recursive: true,
    mode: 0o700,
  });
  await mkdir(evidence, { mode: 0o700 }); // existing run is never overwritten, even on failure
  if (
    (await owner.installation.findUnique({ where: { id: "primary" } }))
      ?.name !==
    "Synthetic " + kind
  )
    throw Error("Unrecognized corpus installation");
  url.username = "townbase_runtime";
  url.password = (
    await readFile("/run/secrets/runtime_password", "utf8")
  ).trim();
  process.env.DATABASE_URL = url.toString();
  process.env.TOWNBASE_MASTER_KEY_FILE = "/run/secrets/model_master";
  for (const n of [
    "DOCUMENTS",
    "ATTACHMENTS",
    "OPERATIONS",
    "BOOTSTRAP",
    "RECOVERY",
  ])
    process.env["TOWNBASE_" + n + "_PATH"] = "/data/" + n.toLowerCase();
  const { DeploymentModule } = r("../dist/deployment/deployment.module"),
    { AuthService } = r("../dist/auth/auth.service"),
    { AgentService } = r("../dist/agent/agent.service"),
    { RagStore } = r("../dist/rag/rag-store"),
    { FileIndexService } = r("../dist/files/file-index.service"),
    { ModelExecutionService } = r(
      "../dist/model-integration/model-execution.service",
    ),
    { strategyFor, selectSources, promptFor } = r("../dist/rag/rag-policy");
  app = await NestFactory.createApplicationContext(DeploymentModule, {
    logger: false,
    abortOnError: false,
  });
  const auth = app.get(AuthService),
    login = await auth.login({
      username: "eval-admin",
      password: "Synthetic evaluation password only!",
    });
  if (!login.ok) throw Error("Login failed");
  const token = login.token,
    c = (await auth.requester(token)).requester,
    fixtures = await corpusFixtures(
      "/workspace/docs/evaluation/v0.2",
      kind as "ops" | "shop",
    ),
    store = app.get(RagStore),
    index = app.get(FileIndexService),
    model = app.get(ModelExecutionService),
    records = [];
  const settings = await model.snapshot(c);
  if (settings.settings.monthlyBudgetUsd !== "0.45")
    throw Error("Preserved corpus budget required");
  let next = Date.now();
  for (const q of fixtures.questions) {
    if (next > Date.now())
      await new Promise((resolve) => setTimeout(resolve, next - Date.now()));
    next = Date.now() + 6100;
    let a;
    try {
      const admitted = await store.admit(
        token,
        c,
        {
          requestId: randomUUID(),
          question: q.question,
          requestedMode: "auto",
          historyRequestIds: [],
        },
        () => false,
      );
      a = admitted.admission;
      if (!a) throw Error("Admission missing");
      const embedded = await model.execute(token, c, {
        requestId: a.turn.embeddingRequestId,
        purpose: "rag_question_embedding",
        input: q.question,
      });
      if (embedded.call.status !== "succeeded" || !embedded.result?.embedding)
        throw Error("Question embedding failed");
      for (let round = 1; round <= 3; round++) {
        const start = performance.now(),
          mode = a.turn.resolvedMode,
          profile = strategyFor(mode);
        const retrieved = await index.search(
          token,
          c,
          embedded.result.embedding,
          20,
          {
            ...(a.config.sourceSelection === "selected"
              ? { originalIds: a.config.sourceOriginalIds }
              : {}),
            knowledgeTypes: profile.knowledgeTypes,
          },
        );
        const selection = selectSources(
          mode,
          retrieved.map((s: Record<string, unknown>) => ({
            ...s,
            requestedMode: "auto",
            resolvedMode: mode,
          })),
          q.question,
        );
        await store.recordSources(token, c, a, selection.sources);
        if (selection.answerable)
          promptFor(
            a.config,
            q.question,
            mode,
            selection.sources,
            [],
            a.inputLimit,
          );
        records.push({
          id: q.id,
          round,
          searchAccessAndPacketMs: performance.now() - start,
          sourceCount: selection.sources.length,
          modelAnswerCalls: 0,
        });
      }
    } finally {
      if (a) await store.fail(c, a.turn, "performance_probe_completed");
    }
    console.log(JSON.stringify({ corpus: kind, id: q.id, measured: true }));
  }
  await writeFile(
    evidence + "/search-packet.json",
    JSON.stringify(
      {
        corpus: kind,
        questionEmbeddings: 60,
        reusedForThreeLocalPasses: true,
        modelAnswerCalls: 0,
        measurement:
          "actual question vector -> authenticated search -> mode ranking/selection -> latest source guards and packet persistence -> prompt construction (when answerable); embedding excluded",
        records,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  await writeFile(
    evidence + "/ledger.json",
    JSON.stringify(await owner.modelCall.findMany(), (_k, v) =>
      typeof v === "bigint" ? v.toString() : v,
    ),
    { mode: 0o600 },
  );
})()
  .catch((e) => {
    process.stderr.write(
      JSON.stringify({
        name: e.name,
        code: e.code ?? null,
        frames: String(e.stack).split("\n").slice(1, 3),
      }) + "\n",
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    const series = process.env.TOWNBASE_EVAL_SERIES;
    if (!series || !/^[a-z0-9-]+$/.test(series))
      throw Error("Explicit performance series required");
    const evidence = `/data/evidence/${kind}/performance/${series}`;
    await mkdir(`/data/evidence/${kind}/performance`, {
      recursive: true,
      mode: 0o700,
    });
    await mkdir(evidence, { mode: 0o700 }); // existing run is never overwritten, even on failure
    await app?.close();
    await owner.$disconnect();
  });
