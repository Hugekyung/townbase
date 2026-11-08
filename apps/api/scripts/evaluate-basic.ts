import "reflect-metadata";
import { createRequire } from "node:module";
import {
  readFile,
  writeFile,
  mkdir,
  appendFile,
  open,
  unlink,
} from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { corpusFixtures } from "./evaluation-fixtures";
const built = createRequire(__filename),
  { PrismaClient } = built("@townbase/database"),
  { NestFactory } = built("@nestjs/core");
const { DeploymentModule } = built("../dist/deployment/deployment.module"),
  { AuthService } = built("../dist/auth/auth.service"),
  { ModelIntegrationService } = built(
    "../dist/model-integration/model-integration.service",
  ),
  { ModelExecutionService } = built(
    "../dist/model-integration/model-execution.service",
  ),
  { AgentService } = built("../dist/agent/agent.service"),
  { RagService } = built("../dist/rag/rag.service"),
  { FileRunService } = built("../dist/files/file-run.service"),
  { FileIndexService } = built("../dist/files/file-index.service"),
  { hashPassword } = built("../dist/setup/password"),
  { PRICE_VERSION } = built("../dist/model-integration/model-policy");
const kind = process.env.TOWNBASE_EVAL_CORPUS as "ops" | "shop",
  live = process.env.TOWNBASE_LIVE_EVALUATION === "1";
if (!live || !["ops", "shop"].includes(kind))
  throw Error("Explicit synthetic live evaluation required");
const dbName = "townbase_live_" + kind + "_test",
  url = new URL(process.env.DATABASE_URL!);
if (url.hostname !== "postgres" || url.pathname !== "/" + dbName)
  throw Error("Dedicated live evaluation DB required");
const series = process.env.TOWNBASE_EVAL_SERIES ?? "baseline";
if (!/^[a-z0-9-]+$/.test(series)) throw Error("Invalid series");
const rounds = Number(process.env.TOWNBASE_EVAL_ROUNDS ?? 3),
  limit = Number(process.env.TOWNBASE_EVAL_QUESTION_LIMIT ?? 60);
if (
  !Number.isInteger(rounds) ||
  rounds < 1 ||
  rounds > 3 ||
  !Number.isInteger(limit) ||
  limit < 1 ||
  limit > 60
)
  throw Error("Invalid evaluation bounds");
const owner = new PrismaClient(),
  base = "/data",
  password = "Synthetic evaluation password only!",
  evidence = path.join(base, "evidence", kind, series);
let app: Awaited<ReturnType<typeof NestFactory.create>>;
let runLock: Awaited<ReturnType<typeof open>> | undefined;
const hash = (v: string | Buffer) =>
  createHash("sha256").update(v).digest("hex");
const normalize = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s,.:;、。]/g, "");
async function main() {
  await mkdir(evidence, { recursive: true, mode: 0o700 });
  runLock = await open(path.join(evidence, ".run.lock"), "wx", 0o600);
  const fixture = await corpusFixtures(
    path.resolve(__dirname, "../../../docs/evaluation/v0.2"),
    kind,
  );
  const sourceCommit = process.env.TOWNBASE_EVAL_SOURCE_COMMIT;
  if (!sourceCommit || !/^[0-9a-f]{40}$/.test(sourceCommit))
    throw Error("Explicit evaluation source commit required");
  const resumeContract = {
    kind,
    series,
    rounds,
    limit,
    sourceCommit,
    questionHash: hash(fixture.questionText),
    corpusHash: hash(fixture.original),
    fixtureHashes: fixture.documents.map((d) => [d.id, hash(d.bytes)]),
    compiledHashes: await Promise.all(
      [
        "rag/rag-policy",
        "rag/rag.service",
        "model-integration/openai-provider",
        "model-integration/model-execution.service",
        "model-integration/grounded-format",
      ].map(async (n) => [
        n,
        hash(await readFile(path.resolve(__dirname, "../dist/" + n + ".js"))),
      ]),
    ),
  };
  const manifestPath = path.join(evidence, "manifest.json");
  const previous = await readFile(manifestPath, "utf8")
    .then(JSON.parse)
    .catch((e) => {
      if (e.code === "ENOENT") return null;
      throw e;
    });
  if (
    previous &&
    JSON.stringify(previous.resumeContract) !== JSON.stringify(resumeContract)
  )
    throw Error("Evaluation resume contract changed");
  if (previous == null) {
    const hasRows = await readFile(
      path.join(evidence, "questions.jsonl"),
      "utf8",
    )
      .then(() => true)
      .catch((e) => {
        if (e.code === "ENOENT") return false;
        throw e;
      });
    if (hasRows) throw Error("Evaluation manifest missing for saved rows");
  }
  const existing = await owner.installation.findFirst();
  if (existing == null) {
    if ((await owner.modelCall.count()) || (await owner.fileOriginal.count()))
      throw Error("Nonempty live evaluation DB");
    const ws = await owner.workspace.create({
      data: { name: "synthetic-live-" + kind },
    });
    await owner.installation.create({
      data: {
        workspaceId: ws.id,
        name: "Synthetic " + kind,
        timeZone: "UTC",
        initializedAt: new Date(),
      },
    });
    await owner.administrator.create({
      data: {
        installationId: "primary",
        username: "eval-admin",
        passwordHash: await hashPassword(password),
      },
    });
  } else if (existing.name !== "Synthetic " + kind)
    throw Error("Unrecognized live evaluation installation");
  url.username = "townbase_runtime";
  url.password = (
    await readFile("/run/secrets/runtime_password", "utf8")
  ).trim();
  process.env.DATABASE_URL = url.toString();
  process.env.TOWNBASE_SETUP_LOCAL_HTTP = "1";
  process.env.TOWNBASE_RUNTIME_PROFILE = "self_hosted";
  process.env.TOWNBASE_MASTER_KEY_FILE = "/run/secrets/model_master";
  for (const name of [
    "DOCUMENTS",
    "ATTACHMENTS",
    "BOOTSTRAP",
    "RECOVERY",
    "OPERATIONS",
  ]) {
    const root = path.join(base, name.toLowerCase());
    await mkdir(root, { recursive: true, mode: 0o700 });
    process.env["TOWNBASE_" + name + "_PATH"] = root;
  }
  app = await NestFactory.create(DeploymentModule, {
    logger: false,
    bodyParser: false,
    abortOnError: false,
  });
  await app.init();
  const auth = app.get(AuthService);
  const login = await auth.login({ username: "eval-admin", password });
  if (!login.ok) throw Error("Synthetic login failed");
  const token = login.token,
    requester = await auth.requester(token);
  if (!requester.ok) throw Error("Synthetic session missing");
  const c = requester.requester;
  const key = (await readFile("/run/secrets/live_key", "utf8")).trim();
  for (const purpose of ["answer", "embedding"]) {
    const credential = await owner.modelCredential.findUnique({
      where: { installationId_purpose: { installationId: "primary", purpose } },
    });
    if (!credential) {
      const r = await app
        .get(ModelIntegrationService)
        .replace(token, password, c, purpose, key);
      if (!r.ok) throw Error("Synthetic credential storage failed");
    }
  }
  const configured = await app
    .get(ModelExecutionService)
    .configure(token, password, c, {
      answerModel: "gpt-6-luna",
      reasoning: "low",
      inputTokenLimit: 16000,
      outputTokenLimit: 2048,
      monthlyBudgetUsd: "0.45",
      priceVersion: PRICE_VERSION,
    });
  if (!configured.ok) throw Error("Synthetic settings failed");
  const transferred = await app
    .get(ModelIntegrationService)
    .setTransfers(token, password, c, {
      documentEmbedding: true,
      rag: true,
      attachment: true,
    });
  if (!transferred.ok) throw Error("Synthetic transfer policy failed");
  const files = app.get(FileRunService);
  const settled = async (ack: { runId: string }) => {
    for (let i = 0; i < 600; i++) {
      const row = await owner.fileRun.findUniqueOrThrow({
        where: { id: ack.runId },
      });
      if (!["queued", "running"].includes(row.status)) {
        if (row.status !== "succeeded")
          throw Error("Synthetic indexing failed: " + row.errorCode);
        return row;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw Error("Synthetic indexing timeout");
  };
  const documents = [];
  for (const document of fixture.documents) {
    let original = await owner.fileOriginal.findFirst({
      where: { title: document.name, deletedAt: null },
    });
    if (!original) {
      const result = await settled(
        await files.upload(
          token,
          c,
          randomUUID(),
          document.name,
          document.bytes,
        ),
      );
      original = await owner.fileOriginal.findUniqueOrThrow({
        where: { id: result.resultOriginalId },
      });
    }
    const version = await owner.fileVersion.findFirstOrThrow({
      where: { originalId: original.id },
      orderBy: { version: "desc" },
    });
    if (version.contentHash !== hash(document.bytes))
      throw Error("Evaluation fixture hash mismatch");
    if (
      !(await owner.fileIndex.count({
        where: {
          originalId: original.id,
          versionId: version.id,
          scopeRevision: original.scopeRevision,
        },
      }))
    )
      await settled(await files.index(token, c, randomUUID(), original.id));
    const extracted = version.extraction as { segments: { text: string }[] };
    for (const fact of document.facts)
      if (
        !normalize(extracted.segments.map((s) => s.text).join("\n")).includes(
          normalize(fact.text),
        )
      )
        throw Error("Fixture fact lost in " + document.id);
    documents.push({
      id: document.id,
      originalId: original.id,
      name: document.name,
      sha256: hash(document.bytes),
      textHash: hash(document.text),
      format: document.format,
      facts: document.facts,
    });
  }
  const current = await app.get(AgentService).snapshot(token, c);
  if (current.agent == null) {
    const saved = await app.get(AgentService).configure(token, password, c, 0, {
      name: "Synthetic document Agent",
      purpose:
        "등록한 합성 문서의 사실·현행/과거 기준·미해결 충돌을 구분해 답합니다.",
      instructions:
        "질문이 기준 확정을 요구하고 동일 시점의 문서가 충돌하면 양쪽을 인용하고 확정을 거절합니다. 본문이 과거/대체됨을 명시한 문서는 현행 기준과 구분합니다.",
      terminology: [],
      sourceSelection: "all",
      sourceOriginalIds: [],
    });
    if (!saved.ok) throw Error("Synthetic Agent configuration failed");
  }
  const index = app.get(FileIndexService),
    originalSearch = index.search.bind(index);
  let searchMs = 0;
  index.search = async (...args: unknown[]) => {
    const start = performance.now();
    try {
      return await originalSearch(...args);
    } finally {
      searchMs += performance.now() - start;
    }
  };
  const { OpenAIProvider } = built("../dist/model-integration/openai-provider");
  const provider = app.get(OpenAIProvider),
    originalCall = provider.call.bind(provider);
  let observingRequestId: string | null = null;
  provider.call = async (...args: unknown[]) => {
    const response = await originalCall(...args);
    const request = args[1] as { model: string; input: string };
    if (request.model !== "text-embedding-3-small")
      await appendFile(
        path.join(evidence, "provider-results.jsonl"),
        JSON.stringify({
          requestId: observingRequestId,
          inputHash: hash(request.input),
          sourceIds: JSON.parse(request.input).sources?.map(
            (s: { id: string }) => s.id,
          ),
          at: new Date().toISOString(),
          text: response.text ?? null,
          outcome: response.outcome,
          providerId: response.providerId,
        }) + "\n",
        { mode: 0o600 },
      );
    return response;
  };
  const settings = await app.get(ModelExecutionService).snapshot(c);
  const manifest = {
    sourceCommit,
    resumeContract,
    at: new Date().toISOString(),
    series,
    compiledArtifacts: Object.fromEntries(
      await Promise.all(
        [
          "rag/rag-policy",
          "rag/rag.service",
          "model-integration/openai-provider",
          "model-integration/model-execution.service",
          "model-integration/grounded-format",
        ].map(async (name) => [
          name,
          hash(
            await readFile(path.resolve(__dirname, "../dist/" + name + ".js")),
          ),
        ]),
      ),
    ),
    compiledPolicyHash: hash(
      await readFile(path.resolve(__dirname, "../dist/rag/rag-policy.js")),
    ),
    image: process.env.TOWNBASE_EVAL_IMAGE ?? null,
    corpus: kind,
    node: process.version,
    arch: process.arch,
    platform: process.platform,
    cpu: os.cpus()[0]?.model,
    cpuCount: os.cpus().length,
    memoryBytes: os.totalmem(),
    cgroupCpu: await readFile("/sys/fs/cgroup/cpu.max", "utf8").catch(
      () => null,
    ),
    cgroupMemory: await readFile("/sys/fs/cgroup/memory.max", "utf8").catch(
      () => null,
    ),
    settings: settings.settings,
    priceVersion: PRICE_VERSION,
    embedding: { model: "text-embedding-3-small", dimensions: 1536 },
    questionHash: hash(fixture.questionText),
    corpusHash: hash(fixture.original),
    documents,
    chunkCount: await owner.fileIndexChunk.count(),
    migrations:
      await owner.$queryRaw`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name`,
    rounds,
    questionLimit: limit,
  };
  const runtimeContract = {
    agent: (await app.get(AgentService).snapshot(token, c)).agent,
    settings: settings.settings,
  };
  if (
    previous &&
    JSON.stringify(previous.runtimeContract) !== JSON.stringify(runtimeContract)
  )
    throw Error("Evaluation runtime contract changed");
  if (previous == null)
    await writeFile(
      manifestPath,
      JSON.stringify({ ...manifest, runtimeContract }, null, 2),
      { flag: "wx", mode: 0o600 },
    );
  const resultPath = path.join(evidence, "questions.jsonl"),
    saved = await readFile(resultPath, "utf8").catch((e) => {
      if (e.code === "ENOENT") return "";
      throw e;
    }),
    completed = new Set(
      saved
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line).round + ":" + JSON.parse(line).id),
    );
  const latest = await owner.ragTurn.findFirst({
    orderBy: { createdAt: "desc" },
  });
  let next = Math.max(
    Date.now(),
    latest ? latest.createdAt.getTime() + 6100 : 0,
  );
  for (let round = 1; round <= rounds; round++)
    for (const q of fixture.questions.slice(0, limit)) {
      const identity = round + ":" + q.id;
      if (completed.has(identity)) continue;
      const wait = Math.max(0, next - Date.now());
      if (wait) await new Promise((r) => setTimeout(r, wait));
      next = Date.now() + 6100;
      // Both question admission and answer calls use rolling windows. Check DB
      // timestamps so variable embedding latency cannot bunch answer dispatches.
      while (true) {
        const now = (await owner.$queryRaw`SELECT clock_timestamp() AS now`)[0]
          .now;
        const since = new Date(now.getTime() - 60000);
        const answers = await owner.modelCall.findMany({
          where: {
            installationId: "primary",
            model: { in: ["gpt-6-luna", "gpt-6.1-sol"] },
            createdAt: { gte: since },
          },
          orderBy: { createdAt: "asc" },
          select: { createdAt: true },
        });
        const turns = await owner.ragTurn.findMany({
          where: { installationId: "primary", createdAt: { gte: since } },
          orderBy: { createdAt: "asc" },
          select: { createdAt: true },
        });
        const waits = [
          answers.length >= 10
            ? answers[0].createdAt.getTime() + 60100 - now.getTime()
            : 0,
          turns.length >= 10
            ? turns[0].createdAt.getTime() + 60100 - now.getTime()
            : 0,
        ];
        const delay = Math.max(...waits);
        if (delay <= 0) break;
        await new Promise((r) => setTimeout(r, delay));
      }
      const { callId } = built("../dist/rag/rag-policy");
      const requestId = callId(
        "evaluation:" + series + ":" + kind + ":" + round + ":" + q.id,
        "answer",
      );
      observingRequestId = requestId;
      searchMs = 0;
      const start = performance.now();
      let result: Record<string, unknown> | null = null,
        errorCode: string | null = null;
      try {
        result = await app.get(RagService).ask(token, c, {
          requestId,
          question: q.question,
          requestedMode: "auto",
        });
      } catch (e) {
        errorCode =
          (e as { code?: string }).code ?? "evaluation_request_failed";
      }
      const latencyMs = performance.now() - start;
      const stored = await owner.ragTurn.findUnique({
        where: {
          installationId_requestId: { installationId: "primary", requestId },
        },
      });
      const sources = (stored?.sources ?? []) as {
        id: string;
        originalId: string;
        content: string;
        score: number;
      }[];
      const gold = [
        ...q.gold.matchAll(/((?:OPS|SHOP)-D\d{2})\/([FLC]\d+)/g),
      ].map((m) => ({ document: m[1]!, heading: m[2]! }));
      const hits = gold.map((g) => {
        const d = documents.find((d) => d.id === g.document),
          fact = d?.facts.find((f) => f.heading === g.heading);
        return (
          !!d &&
          !!fact &&
          sources
            .slice(0, 5)
            .some(
              (s) =>
                s.originalId === d.originalId &&
                normalize(s.content).includes(normalize(fact.text)),
            )
        );
      });
      const calls = await owner.modelCall.findMany({
        where: {
          installationId: "primary",
          purpose: { in: ["rag_answer", "rag_question_embedding"] },
          requestId: {
            in: [callId(requestId, "answer"), callId(requestId, "embedding")],
          },
        },
        select: {
          requestId: true,
          status: true,
          model: true,
          usage: true,
          chargedNanoUsd: true,
          reservedNanoUsd: true,
          errorCode: true,
        },
      });
      const record = {
        round,
        ...q,
        requestId,
        result,
        errorCode,
        latencyMs,
        searchMs,
        hitAt5: gold.length ? hits.some(Boolean) : null,
        completeGoldRetrieval: gold.length ? hits.every(Boolean) : null,
        gold,
        sources: sources.map((s) => ({
          ...s,
          document: documents.find((d) => d.originalId === s.originalId)?.id,
        })),
        calls: calls.map((v) => ({
          ...v,
          chargedNanoUsd: v.chargedNanoUsd?.toString() ?? null,
          reservedNanoUsd: v.reservedNanoUsd.toString(),
        })),
      };
      await appendFile(resultPath, JSON.stringify(record) + "\n", {
        mode: 0o600,
      });
      console.log(
        JSON.stringify({
          corpus: kind,
          round,
          id: q.id,
          status: result?.status ?? errorCode,
          hit: record.hitAt5,
          expected: q.isAnswerable,
          actual: result?.isAnswerable,
        }),
      );
    }
  await writeFile(
    path.join(evidence, "ledger.json"),
    JSON.stringify(
      await owner.modelCall.findMany(),
      (_k, v) => (typeof v === "bigint" ? v.toString() : v),
      2,
    ),
  );
  console.log("SYNTHETIC_EVALUATION_COMPLETED");
}
main()
  .catch((error) => {
    const allowed = [
      "Evaluation resume contract changed",
      "Evaluation runtime contract changed",
      "Evaluation manifest missing for saved rows",
      "Evaluation fixture hash mismatch",
      "Explicit evaluation source commit required",
      "Dedicated live evaluation DB required",
      "Synthetic indexing failed",
      "Synthetic transfer policy failed",
      "Synthetic Agent configuration failed",
    ];
    const reason =
      allowed.find(
        (v) =>
          error instanceof Error &&
          (error.message === v || error.message.startsWith(v + ":")),
      ) ?? "unexpected_failure";
    console.error(
      JSON.stringify({ code: "TOWNBASE_SYNTHETIC_EVALUATION_FAILED", reason }),
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await app?.close();
      await owner.$disconnect();
    } finally {
      if (runLock) {
        await runLock.close();
        await unlink(path.join(evidence, ".run.lock"));
      }
    }
  });
