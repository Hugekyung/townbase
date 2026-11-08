import "reflect-metadata";
import { createRequire } from "node:module";
import { readFile, mkdir, appendFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { unicodePdf, unicodeDocx } from "./evaluation-fixtures";
const r = createRequire(__filename);
if (process.env.TOWNBASE_LIVE_EVALUATION !== "1")
  throw Error("Explicit live permission required");
const url = new URL(process.env.DATABASE_URL!);
if (
  url.hostname !== "postgres" ||
  url.pathname !== "/townbase_live_diagnostic_test"
)
  throw Error("Dedicated synthetic DB required");
const { PrismaClient } = r("@townbase/database"),
  { NestFactory } = r("@nestjs/core");
const series = process.env.TOWNBASE_EVAL_SERIES ?? "baseline";
if (!/^[a-z0-9-]+$/.test(series)) throw Error("Invalid series");
const output = "/diag/evidence/attachments-" + series;
const owner = new PrismaClient();
let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>;
(async () => {
  await mkdir("/diag/evidence", { recursive: true, mode: 0o700 });
  await mkdir(output, { mode: 0o700 }); // reject reruns before any paid work
  const install = await owner.installation.findUnique({
    where: { id: "primary" },
  });
  const password = "Synthetic diagnostic password!";
  if (install == null) {
    if (
      (await owner.modelCall.count()) ||
      (await owner.fileOriginal.count()) ||
      (await owner.document.count()) ||
      (await owner.attachmentTask.count())
    )
      throw Error("Nonempty evaluation DB");
    const { hashPassword } = r("../dist/setup/password");
    const workspace = await owner.workspace.create({
      data: { name: "synthetic-diagnostic" },
    });
    await owner.installation.create({
      data: {
        id: "primary",
        workspaceId: workspace.id,
        name: "Synthetic diagnostic",
        timeZone: "UTC",
        initializedAt: new Date(),
      },
    });
    await owner.administrator.create({
      data: {
        installationId: "primary",
        username: "diag",
        passwordHash: await hashPassword(password),
      },
    });
  } else if (install.name !== "Synthetic diagnostic")
    throw Error("Unrecognized installation");
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
  ]) {
    const p = "/diag/" + n.toLowerCase();
    await mkdir(p, { recursive: true, mode: 0o700 });
    process.env["TOWNBASE_" + n + "_PATH"] = p;
  }
  const { DeploymentModule } = r("../dist/deployment/deployment.module"),
    { AuthService } = r("../dist/auth/auth.service"),
    { ModelIntegrationService } = r(
      "../dist/model-integration/model-integration.service",
    ),
    { ModelExecutionService } = r(
      "../dist/model-integration/model-execution.service",
    ),
    { AttachmentService } = r("../dist/attachments/attachment.service"),
    { AttachmentStore } = r("../dist/attachments/attachment-store"),
    { AgentService } = r("../dist/agent/agent.service"),
    { PRICE_VERSION } = r("../dist/model-integration/model-policy");
  app = await NestFactory.createApplicationContext(DeploymentModule, {
    logger: false,
    abortOnError: false,
  });
  const auth = app.get(AuthService),
    login = await auth.login({ username: "diag", password });
  if (!login.ok) throw Error("Login failed");
  const token = login.token,
    c = (await auth.requester(token)).requester;
  if (
    !(await owner.modelCredential.findUnique({
      where: {
        installationId_purpose: {
          installationId: "primary",
          purpose: "answer",
        },
      },
    }))
  ) {
    const key = (await readFile("/run/secrets/live_key", "utf8")).trim();
    const stored = await app
      .get(ModelIntegrationService)
      .replace(token, password, c, "answer", key);
    if (!stored.ok) throw Error("Synthetic credential storage failed");
  }
  const transferSetup = await app
    .get(ModelIntegrationService)
    .setTransfers(token, password, c, {
      documentEmbedding: false,
      rag: false,
      attachment: true,
    });
  if (!transferSetup.ok) throw Error("Synthetic transfer policy failed");
  const executionSetup = await app
    .get(ModelExecutionService)
    .configure(token, password, c, {
      answerModel: "gpt-6-luna",
      reasoning: "low",
      inputTokenLimit: 16000,
      outputTokenLimit: 2048,
      monthlyBudgetUsd: "0.05",
      priceVersion: PRICE_VERSION,
    });
  const agent = app.get(AgentService);
  const snap = await agent.snapshot(token, c);
  if (!executionSetup.ok)
    throw Error("Synthetic execution configuration failed");
  const saved = await agent.configure(
    token,
    password,
    c,
    snap.agent?.revision ?? 0,
    {
      name: "합성 첨부 Agent",
      purpose: "첨부 문서의 사실만 사용합니다.",
      instructions: "",
      terminology: [],
      sourceSelection: "all",
      sourceOriginalIds: [],
    },
  );
  if (!saved.ok) throw Error("Agent failed");
  const service = app.get(AttachmentService),
    store = app.get(AttachmentStore),
    text =
      "행사 운영 메모\n행사 예산은 50,000원입니다.\n담당자는 민수입니다.\n행사 일시는 2026년 12월 1일 오후 2시입니다.";
  const baseline = {
    documents: await owner.document.count(),
    chunks: await owner.documentChunk.count(),
    gaps: await owner.knowledgeGap.count(),
    drafts: await owner.actionDraft.count(),
  };
  const measured = {
    uploaded: 0,
    ownerResults: 0,
    readbackEqual: 0,
    rawDeleted: 0,
  };
  for (const format of ["txt", "md", "pdf", "docx"]) {
    for (const operation of ["summary", "question", "draft"]) {
      const name = "public-synthetic." + format,
        bytes =
          format === "pdf"
            ? unicodePdf(text)
            : format === "docx"
              ? unicodeDocx(text)
              : Buffer.from(text);
      const file = await service.upload(token, c, name, bytes),
        requestId = randomUUID(),
        start = Date.now();
      const result = await service.ask(token, c, {
        requestId,
        attachmentIds: [file.id],
        operation,
        question:
          operation === "summary"
            ? "행사 예산과 담당자를 요약해 줘."
            : operation === "draft"
              ? "문서에 있는 예산과 담당자만 포함한 행사 안내문 초안을 작성해 줘."
              : "행사 예산과 담당자는 누구야?",
        historyRequestIds: [],
      });
      const read = await store.read(token, c, requestId),
        row = await owner.attachment.findUnique({ where: { id: file.id } });
      measured.uploaded++;
      if (result.status === "answered") measured.ownerResults++;
      if (JSON.stringify(read) === JSON.stringify(result))
        measured.readbackEqual++;
      if (row.rawDeletedAt != null) measured.rawDeleted++;
      await appendFile(
        output + "/cases.jsonl",
        JSON.stringify({
          format,
          operation,
          requestId,
          elapsedMs: Date.now() - start,
          result,
          readbackEqual: JSON.stringify(read) === JSON.stringify(result),
          rawDeleted: row.rawDeletedAt != null,
        }) + "\n",
        { mode: 0o600 },
      );
      console.log(JSON.stringify({ format, operation, status: result.status }));
      await new Promise((r) => setTimeout(r, 6100));
    }
  }
  const after = {
    documents: await owner.document.count(),
    chunks: await owner.documentChunk.count(),
    gaps: await owner.knowledgeGap.count(),
    drafts: await owner.actionDraft.count(),
  };
  await writeFile(
    output + "/summary.json",
    JSON.stringify(
      {
        series,
        measured,
        baseline,
        after,
        sharedUnchanged: JSON.stringify(baseline) === JSON.stringify(after),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  await writeFile(
    output + "/ledger.json",
    JSON.stringify(await owner.modelCall.findMany(), (_k, v) =>
      typeof v === "bigint" ? v.toString() : v,
    ),
    { mode: 0o600 },
  );
})()
  .catch((e) => {
    console.error(
      JSON.stringify({
        name: e.name,
        code: e.code ?? null,
        frames: String(e.stack).split("\n").slice(1, 3),
      }),
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await mkdir("/diag/evidence", { recursive: true, mode: 0o700 });
    await mkdir(output, { mode: 0o700 }); // reject reruns before any paid work
    await app?.close();
    await owner.$disconnect();
  });
