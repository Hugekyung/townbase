import "reflect-metadata";
import { docx, pdf, encryptedPdf } from "./file-fixtures";
import { readdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient, Prisma } from "@townbase/database";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import type {
  ProviderRequest,
  ProviderResult,
} from "../src/model-integration/openai-provider";
import { assertFreshFileManagementDatabase } from "./file-management-fixture";

const built = createRequire(__filename);
const { DeploymentModule } = built(
  "../dist/deployment/deployment.module",
) as typeof import("../src/deployment/deployment.module");
const { configureSelfHostedHttp } = built(
  "../dist/deployment/self-hosted-http",
) as typeof import("../src/deployment/self-hosted-http");
const { OpenAIProvider } = built(
  "../dist/model-integration/openai-provider",
) as typeof import("../src/model-integration/openai-provider");
const { ModelExecutionService } = built(
  "../dist/model-integration/model-execution.service",
) as typeof import("../src/model-integration/model-execution.service");
const { ModelIntegrationService } = built(
  "../dist/model-integration/model-integration.service",
) as typeof import("../src/model-integration/model-integration.service");
const { AuthService } = built(
  "../dist/auth/auth.service",
) as typeof import("../src/auth/auth.service");
const { AgentService } = built(
  "../dist/agent/agent.service",
) as typeof import("../src/agent/agent.service");
const { FileIndexService } = built(
  "../dist/files/file-index.service",
) as typeof import("../src/files/file-index.service");
const { FileRunService } = built(
  "../dist/files/file-run.service",
) as typeof import("../src/files/file-run.service");
const { PRICE_VERSION } = built(
  "../dist/model-integration/model-policy",
) as typeof import("../src/model-integration/model-policy");
const { hashPassword } = built(
  "../dist/setup/password",
) as typeof import("../src/setup/password");
const integration =
  process.env.TOWNBASE_FINAL_BASIC_TEST === "1" ? describe : describe.skip;

integration(
  "Final basic attachments and document Agent, synthetic provider and actual restricted DB",
  () => {
    jest.setTimeout(60000);
    const environment = { ...process.env },
      password = "RAG synthetic fixture password!";
    let owner: PrismaClient,
      app: NestExpressApplication,
      directory: string,
      cookie = "",
      token: string;
    let workspaceId: string | undefined, administratorId: string;
    let originalId: string, secondOriginalId: string;
    let context: Awaited<
      ReturnType<InstanceType<typeof AuthService>["requester"]>
    >;
    let variant:
      | "normal"
      | "invalid"
      | "refusal"
      | "incomplete"
      | "outage"
      | "conflict" = "normal";
    let hold: ((r: ProviderRequest) => Promise<void>) | undefined;
    const vector = (axis = 0) =>
      Array.from({ length: 1536 }, (_, i) => (i === axis ? 1 : 0));
    const provider = {
      call: jest.fn(
        async (
          _key: string,
          r: ProviderRequest,
          signal: AbortSignal,
        ): Promise<ProviderResult> => {
          if (hold) {
            await new Promise<void>((resolve, reject) => {
              const abort = () =>
                reject(
                  Object.assign(new Error("cancelled"), { name: "AbortError" }),
                );
              if (signal.aborted) return abort();
              signal.addEventListener("abort", abort, { once: true });
              hold!(r)
                .then(resolve, reject)
                .finally(() => signal.removeEventListener("abort", abort));
            });
          }
          if (variant === "outage" && r.model !== "text-embedding-3-small")
            throw new Error("Synthetic provider failure");
          const usage = {
            input: 20,
            cached: 0,
            write30: 0,
            write12: 0,
            output: r.model === "text-embedding-3-small" ? 0 : 40,
            reasoning: 0,
          };
          if (r.model === "text-embedding-3-small")
            return {
              usage,
              providerId: null,
              outcome: "succeeded",
              embedding: vector(r.input.startsWith("알수없음") ? 1 : 0),
            };
          const input = JSON.parse(r.input) as {
            sources: { id: string; content: string }[];
          };
          const first = input.sources[0]!;
          const result =
            variant === "conflict"
              ? {
                  isAnswerable: false,
                  reason: "문서의 배송 기준이 달라 확정할 수 없습니다.",
                  claims: [],
                  conflicts: [
                    {
                      text: "배송 시점이 문서마다 다릅니다.",
                      evidence: input.sources.slice(0, 2).map((s) => ({
                        sourceId: s.id,
                        quote: s.content.slice(0, 30),
                      })),
                    },
                  ],
                }
              : variant === "refusal"
                ? {
                    isAnswerable: false,
                    reason: "관련 근거가 충분하지 않습니다.",
                    claims: [],
                    conflicts: [],
                  }
                : {
                    isAnswerable: true,
                    reason: "",
                    claims: [
                      {
                        text: "배송은 등록된 문서의 절차를 따릅니다.",
                        evidence: [
                          {
                            sourceId: first.id,
                            quote:
                              variant === "invalid"
                                ? "원문에 없는 문장"
                                : first.content.slice(0, 30),
                          },
                        ],
                      },
                    ],
                    conflicts: [],
                  };
          return {
            usage,
            providerId: "synthetic-rag",
            outcome: variant === "incomplete" ? "incomplete" : "succeeded",
            text: JSON.stringify(result),
          };
        },
      ),
    };
    const headers = () => ({
      Host: "127.0.0.1:3000",
      Origin: "http://127.0.0.1:3000",
      "X-Townbase-Auth": "1",
      Cookie: cookie,
    });
    const call = (method: "get" | "post" | "put" | "delete", url: string) =>
      request(app.getHttpServer())[method](url).set(headers());
    const input = (overrides: Record<string, unknown> = {}) => ({
      requestId: String(randomUUID()),
      question: "배송 절차를 알려줘",
      requestedMode: "auto",
      ...overrides,
    });
    const ask = (body = input()) => call("post", "/rag/questions").send(body);
    async function start() {
      const module = await Test.createTestingModule({
        imports: [DeploymentModule],
      })
        .overrideProvider(OpenAIProvider)
        .useValue(provider)
        .compile();
      app = module.createNestApplication<NestExpressApplication>({
        bodyParser: false,
      });
      configureSelfHostedHttp(app);
      await app.init();
    }
    async function login() {
      const r = await call("post", "/auth/login")
        .send({ username: "rag-admin", password })
        .expect(200);
      cookie = (r.headers["set-cookie"] as unknown as string[])[0]!.split(
        ";",
      )[0]!;
      token = cookie.slice(cookie.indexOf("=") + 1);
      context = await app.get(AuthService).requester(token);
      if (!context.ok) throw new Error("Synthetic requester missing");
      return context.requester;
    }
    async function settled(ack: { runId: string }) {
      for (let i = 0; i < 400; i++) {
        const row = await owner.fileRun.findUniqueOrThrow({
          where: { id: ack.runId },
        });
        if (!["queued", "running"].includes(row.status)) {
          await (app.get(FileRunService) as unknown as { task?: Promise<void> })
            .task;
          expect(row.status).toBe("succeeded");
          return row;
        }
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
      throw new Error("File fixture did not settle");
    }
    async function configureModel() {
      const c = await login();
      await app.get(ModelExecutionService).configure(token, password, c, {
        answerModel: "gpt-6-luna",
        reasoning: "low",
        inputTokenLimit: 16000,
        outputTokenLimit: 4096,
        monthlyBudgetUsd: "5.00",
        priceVersion: PRICE_VERSION,
      });
      await app.get(ModelIntegrationService).setTransfers(token, password, c, {
        documentEmbedding: true,
        rag: true,
        attachment: true,
      });
    }
    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL!);
      if (
        url.hostname !== "postgres" ||
        url.pathname !== "/townbase_final_test"
      )
        throw new Error("Dedicated RAG DB required");
      owner = new PrismaClient({
        datasources: { db: { url: url.toString() } },
      });
      await assertFreshFileManagementDatabase(owner);
      if (
        (await owner.attachment.count()) ||
        (await owner.attachmentTask.count()) ||
        (await owner.ragConversation.count()) ||
        (await owner.ragGap.count())
      )
        throw new Error("Fresh RAG fixture required");
      const hash = await hashPassword(password);
      const fixture = await owner.$transaction(async (tx) => {
        const w = await tx.workspace.create({
          data: { name: "RAG synthetic fixture" },
        });
        await tx.installation.create({
          data: {
            workspaceId: w.id,
            name: "RAG synthetic",
            timeZone: "UTC",
            initializedAt: new Date(),
          },
        });
        const admin = await tx.administrator.create({
          data: {
            installationId: "primary",
            username: "rag-admin",
            passwordHash: hash,
          },
        });
        return { workspaceId: w.id, administratorId: admin.id };
      });
      workspaceId = fixture.workspaceId;
      administratorId = fixture.administratorId;
      url.username = "townbase_runtime";
      url.password = (
        await readFile(process.env.TOWNBASE_RUNTIME_PASSWORD_FILE!, "utf8")
      ).trim();
      process.env.DATABASE_URL = url.toString();
      process.env.TOWNBASE_SETUP_LOCAL_HTTP = "1";
      process.env.TOWNBASE_RUNTIME_PROFILE = "self_hosted";
      delete process.env.TOWNBASE_PUBLIC_ORIGIN;
      directory = await mkdtemp(path.join(tmpdir(), "townbase-rag-"));
      for (const name of [
        "BOOTSTRAP",
        "RECOVERY",
        "DOCUMENTS",
        "ATTACHMENTS",
      ]) {
        process.env[`TOWNBASE_${name}_PATH`] = path.join(directory, name);
        await mkdir(process.env[`TOWNBASE_${name}_PATH`]!);
      }
      process.env.TOWNBASE_MASTER_KEY_FILE = path.join(directory, "master");
      await writeFile(
        process.env.TOWNBASE_MASTER_KEY_FILE,
        randomBytes(32).toString("base64url"),
        { mode: 0o444 },
      );
      await start();
      const c = await login();
      for (const purpose of ["answer", "embedding"] as const)
        await app
          .get(ModelIntegrationService)
          .replace(
            token,
            password,
            c,
            purpose,
            "sk-proj-RAG-synthetic-fixture-key-1234567890",
          );
      await configureModel();
      const registered = await call("post", "/files")
        .set("X-Townbase-Request-Id", randomUUID())
        .send({
          name: "delivery.txt",
          contentBase64: Buffer.from(
            "배송은 주문 확인 후 진행합니다.\n관리자는 출고 내역을 확인합니다.",
          ).toString("base64"),
        })
        .expect(202);
      originalId = (await settled(registered.body)).resultOriginalId!;
      await settled(
        (
          await call("post", `/files/${originalId}/index`)
            .set("X-Townbase-Request-Id", randomUUID())
            .send({})
            .expect(202)
        ).body,
      );
      const secondRegistered = await call("post", "/files")
        .set("X-Townbase-Request-Id", randomUUID())
        .send({
          name: "delivery-history.txt",
          contentBase64: Buffer.from(
            "배송은 결제 확인 후 이틀 뒤 진행합니다. 출고 기준에 대한 이전 기록입니다.",
          ).toString("base64"),
        })
        .expect(202);
      secondOriginalId = (await settled(secondRegistered.body))
        .resultOriginalId!;
      await settled(
        (
          await call("post", `/files/${secondOriginalId}/index`)
            .set("X-Townbase-Request-Id", randomUUID())
            .send({})
            .expect(202)
        ).body,
      );
      await app.get(AgentService).configure(token, password, c, 0, {
        name: "배송 도우미",
        purpose: "배송 문서 답변",
        instructions: "짧게 답변",
        terminology: [],
        sourceSelection: "selected",
        sourceOriginalIds: [originalId],
      });
    });
    beforeEach(async () => {
      await owner.attachment.deleteMany();
      await owner.attachmentTask.deleteMany();
      jest.restoreAllMocks();
      variant = "normal";
      hold = undefined;
      if (!workspaceId) throw new Error("RAG fixture missing");
      const scope = {
        installationId: "primary",
        ownerAdministratorId: administratorId,
      };
      await owner.ragGap.deleteMany({ where: scope });
      await owner.ragTurn.deleteMany({ where: scope });
      await owner.ragConversation.deleteMany({ where: scope });
      await owner.modelCall.deleteMany({
        where: {
          ...scope,
          purpose: {
            in: ["rag_answer", "rag_question_embedding", "attachment_answer"],
          },
        },
      });
      // Source state is a known synthetic fixture, never an existing/live DB.
      await owner.fileOriginal.update({
        where: { id: originalId },
        data: { excludedAt: null, deletedAt: null, scopeRevision: 1 },
      });
      await owner.basicAgent.update({
        where: { installationId: "primary" },
        data: {
          sourceSelection: "selected",
          sourceOriginalIds: [originalId],
          instructions: "짧게 답변",
        },
      });
      await configureModel();
      if (!(await owner.fileIndex.count({ where: { originalId } }))) {
        await settled(
          (
            await call("post", `/files/${originalId}/index`)
              .set("X-Townbase-Request-Id", randomUUID())
              .send({})
              .expect(202)
          ).body,
        );
      }
      provider.call.mockClear();
    });
    afterAll(async () => {
      hold = undefined;
      try {
        await app?.close();
        if (workspaceId) {
          const scope = { installationId: "primary" };
          await owner.$transaction(async (tx) => {
            await tx.attachment.deleteMany({ where: scope });
            await tx.attachmentTask.deleteMany({ where: scope });
            await tx.ragGap.deleteMany({ where: scope });
            await tx.ragTurn.deleteMany({ where: scope });
            await tx.ragConversation.deleteMany({ where: scope });
            await tx.basicAgent.deleteMany({ where: scope });
            await tx.fileIndex.deleteMany({ where: scope });
            await tx.fileRunRequest.deleteMany({ where: scope });
            await tx.fileRun.deleteMany({ where: scope });
            await tx.fileExtractionRun.deleteMany({ where: scope });
            await tx.fileVersion.deleteMany({ where: scope });
            await tx.fileOriginal.deleteMany({ where: scope });
            await tx.modelCall.deleteMany({ where: scope });
            await tx.modelCredential.deleteMany({ where: scope });
            await tx.modelTransferPolicy.deleteMany({ where: scope });
            await tx.modelExecutionSettings.deleteMany({ where: scope });
            await tx.administratorSession.deleteMany({ where: scope });
            await tx.installationAuditEvent.deleteMany({ where: scope });
            await tx.administrator.delete({ where: { id: administratorId } });
            await tx.installation.delete({
              where: { id: "primary", workspaceId: workspaceId! },
            });
            await tx.workspace.delete({ where: { id: workspaceId! } });
          });
        }
      } finally {
        await owner?.$disconnect();
        if (directory) await rm(directory, { recursive: true, force: true });
        process.env = environment;
      }
    });

    const { DeletionJournal } = built(
      "../dist/operations/deletion-journal",
    ) as typeof import("../src/operations/deletion-journal");
    const { OperationsService } = built(
      "../dist/operations/operations.service",
    ) as typeof import("../src/operations/operations.service");
    test("operations reports scoped counts and prunes old audit/session data without erasing costs", async () => {
      const old = await owner.installationAuditEvent.create({
        data: {
          installationId: "primary",
          actorType: "administrator",
          actorAdministratorId: administratorId,
          action: "file_registered",
          outcome: "succeeded",
          requestId: randomUUID(),
          occurredAt: new Date(Date.now() - 91 * 86400000),
        },
      });
      const session = await owner.administratorSession.findFirstOrThrow();
      const oldSessionHash = randomBytes(32).toString("hex");
      const created = new Date(Date.now() - 92 * 86400000);
      await owner.administratorSession.create({
        data: {
          ...session,
          tokenHash: oldSessionHash,
          createdAt: created,
          lastSeenAt: created,
          expiresAt: new Date(created.getTime() + 3600000),
          revokedAt: null,
        },
      });
      await ask().expect(200);
      const count = await owner.modelCall.count();
      await app.get(OperationsService).retention();
      expect(
        await owner.installationAuditEvent.findUnique({
          where: { id: old.id },
        }),
      ).toBeNull();
      expect(
        await owner.administratorSession.findUnique({
          where: { tokenHash: oldSessionHash },
        }),
      ).toBeNull();
      expect(await owner.modelCall.count()).toBe(count);
      const response = await call("get", "/operations").expect(200);
      expect(response.body.counts.documents).toBe(2);
      expect(response.body.retention.diagnosticDays).toBe(7);
      expect(JSON.stringify(response.body)).not.toContain("sk-proj-");
    });
    test("dedicated session lock survives configured pool recycling and ownership loss still blocks readiness", async () => {
      const runs = app.get(FileRunService);
      const originalUrl = process.env.DATABASE_URL!;
      const short = new URL(originalUrl);
      short.searchParams.set("max_idle_connection_lifetime", "1");
      short.searchParams.set("max_connection_lifetime", "1");
      let lease: PrismaClient | undefined;
      try {
        process.env.DATABASE_URL = short.toString();
        lease = await (
          runs as unknown as { lock(key: number): Promise<PrismaClient> }
        ).lock(97);
      } finally {
        process.env.DATABASE_URL = originalUrl;
      }
      try {
        const [first] = await lease!.$queryRaw<
          { pid: number }[]
        >`SELECT pg_backend_pid() AS pid`;
        await new Promise((resolve) => setTimeout(resolve, 2200));
        const [next] = await lease!.$queryRaw<
          { pid: number; owned: boolean }[]
        >`SELECT pg_backend_pid() AS pid, EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND classid=741126::oid AND objid=97::oid AND objsubid=2) AS owned`;
        expect(next?.pid).toBe(first?.pid);
        expect(next?.owned).toBe(true);
      } finally {
        await lease?.$disconnect();
      }
      const internal = runs as unknown as { owner: PrismaClient };
      // Explicitly releasing ownership simulates a lost session without racing timers.
      await internal.owner
        .$queryRaw`SELECT pg_advisory_unlock(741126,4) AS released`;
      try {
        await call("get", "/readyz").expect(503);
        expect(await runs.ready()).toBe(false);
      } finally {
        await app.close();
        await start();
        await login();
      }
    });
    test("chat model and effort reach the provider, persist on readback and do not change global defaults", async () => {
      const modelOptions = { answerModel: "gpt-6.1-sol", reasoning: "high" };
      const body = input({ modelOptions });
      const result = await ask(body).expect(200);
      expect(result.body.status).toBe("answered");
      expect(result.body.model).toBe(modelOptions.answerModel);
      expect(result.body.modelOptions).toEqual(modelOptions);
      expect(
        provider.call.mock.calls.some(
          ([, r]) => r.model === "gpt-6.1-sol" && r.reasoning === "high",
        ),
      ).toBe(true);
      expect(
        provider.call.mock.calls.some(
          ([, r]) => r.model === "text-embedding-3-small",
        ),
      ).toBe(true);
      expect(
        (await call("get", "/rag/questions/" + body.requestId).expect(200)).body
          .modelOptions,
      ).toEqual(modelOptions);
      const stored = await owner.ragTurn.findFirstOrThrow({
        where: { requestId: body.requestId },
      });
      expect(stored.modelOptions).toEqual(modelOptions);
      const count = provider.call.mock.calls.length;
      await ask(
        input({
          ...body,
          modelOptions: { answerModel: "gpt-6-luna", reasoning: "low" },
        }),
      ).expect(409);
      expect(provider.call.mock.calls).toHaveLength(count);
      const defaults = await owner.modelExecutionSettings.findUniqueOrThrow({
        where: { installationId: "primary" },
      });
      expect(defaults.answerModel).toBe("gpt-6-luna");
      expect(defaults.reasoning).toBe("low");
    });
    test("a higher-cost chat choice remains subject to the installation budget", async () => {
      if (!context.ok) throw Error("Fixture requester missing");
      await app
        .get(ModelExecutionService)
        .configure(token, password, context.requester, {
          answerModel: "gpt-6-luna",
          reasoning: "low",
          inputTokenLimit: 16000,
          outputTokenLimit: 4096,
          monthlyBudgetUsd: "0.01",
          priceVersion: PRICE_VERSION,
        });
      const result = await ask(
        input({
          modelOptions: { answerModel: "gpt-6.1-sol", reasoning: "high" },
        }),
      ).expect(200);
      expect(result.body.status).toBe("failed");
      expect(result.body.errorCode).toBe("budget_exceeded");
      expect(
        provider.call.mock.calls.every(
          ([, r]) => r.model === "text-embedding-3-small",
        ),
      ).toBe(true);
    });
    test("invalid chat choices cannot persist or charge and embedding cannot be overridden", async () => {
      const count = await owner.modelCall.count();
      for (const modelOptions of [
        null,
        { answerModel: "text-embedding-3-large", reasoning: "low" },
        { answerModel: "gpt-6.1-sol", reasoning: "none" },
        {
          answerModel: "gpt-6-luna",
          reasoning: "low",
          monthlyBudgetUsd: "9999",
        },
      ])
        await ask(input({ modelOptions })).expect(400);
      expect(await owner.modelCall.count()).toBe(count);
      expect(await owner.ragTurn.count()).toBe(0);
    });
    test("usage dashboard counts owned current-month usage and separates held cost from charged cost", async () => {
      await ask(input()).expect(200);
      const row = await owner.modelCall.findFirstOrThrow({
        where: { purpose: "rag_answer" },
      });
      const old = new Date(
        Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 15),
      );
      await owner.modelCall.create({
        data: {
          ...row,
          usage: row.usage as Prisma.InputJsonValue,
          requestId: randomUUID(),
          createdAt: old,
          deadlineAt: new Date(old.getTime() + 90000),
          completedAt: new Date(old.getTime() + 500),
        },
      });
      await owner.modelCall.create({
        data: {
          ...row,
          requestId: randomUUID(),
          status: "unknown",
          usage: Prisma.DbNull,
          chargedNanoUsd: null,
          reservedNanoUsd: 123n,
        },
      });
      const response = await call(
        "get",
        "/settings/model-integration/usage",
      ).expect(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      const answer = response.body.groups.filter(
        (g: { purpose: string }) => g.purpose === "rag_answer",
      );
      expect(
        answer.reduce(
          (n: number, g: { calls: string }) => n + Number(g.calls),
          0,
        ),
      ).toBe(2);
      expect(
        answer.reduce(
          (n: number, g: { inputTokens: string }) => n + Number(g.inputTokens),
          0,
        ),
      ).toBe(20);
      expect(
        answer.find((g: { status: string }) => g.status === "unknown").heldUsd,
      ).toBe("0.000000123");
      expect(response.body.timeZone).toBe("UTC");
      expect(JSON.stringify(response.body)).not.toContain("sk-proj-");
      if (!context.ok) throw Error("Fixture requester missing");
      const other = await app
        .get(ModelExecutionService)
        .usage({ ...context.requester, administratorId: "not-the-owner" });
      expect(other.groups).toEqual([]);
      expect(other.daily).toEqual([]);
      await request(app.getHttpServer())
        .get("/settings/model-integration/usage")
        .set({
          Host: "127.0.0.1:3000",
          Origin: "http://127.0.0.1:3000",
          "X-Townbase-Auth": "1",
        })
        .expect(401);
    });
    async function upload(
      name = "private.txt",
      bytes: Buffer = Buffer.from(
        "ATTACH-ONLY-OPS-731 private terms: fee 50, owner Lee.",
      ),
    ) {
      return (
        await call("post", "/attachments")
          .send({ name, contentBase64: bytes.toString("base64") })
          .expect(201)
      ).body;
    }
    const task = (id: string, extra: Record<string, unknown> = {}) => ({
      requestId: randomUUID(),
      question: "Summarize the supplied evidence",
      operation: "summary",
      attachmentIds: [id],
      ...extra,
    });
    test("private attachment uses and retains the selected model and effort", async () => {
      const file = await upload();
      const modelOptions = { answerModel: "gpt-6.1-sol", reasoning: "medium" };
      const body = task(file.id, { modelOptions });
      const result = await call("post", "/attachment-tasks")
        .send(body)
        .expect(200);
      expect(result.body.modelOptions).toEqual(modelOptions);
      expect(result.body.model).toBe("gpt-6.1-sol");
      expect(
        provider.call.mock.calls.some(
          ([, r]) => r.model === "gpt-6.1-sol" && r.reasoning === "medium",
        ),
      ).toBe(true);
      expect(
        (await call("get", "/attachment-tasks/" + body.requestId).expect(200))
          .body.modelOptions,
      ).toEqual(modelOptions);
      expect(
        (await owner.attachmentTask.findFirstOrThrow()).modelOptions,
      ).toEqual(modelOptions);
    });
    const sharedCounts = async () => ({
      documents: await owner.document.count(),
      chunks: await owner.documentChunk.count(),
      gaps: await owner.ragGap.count(),
      legacyGaps: await owner.knowledgeGap.count(),
      drafts: await owner.actionDraft.count(),
      indexes: await owner.fileIndex.count(),
    });
    test.each([
      ["txt", () => Buffer.from("ATTACH-ONLY-OPS-731 fee 50 owner Lee")],
      [
        "md",
        () => Buffer.from("# Private\nATTACH-ONLY-OPS-731 fee 50 owner Lee"),
      ],
      ["pdf", () => pdf("ATTACH-ONLY-OPS-731 fee 50 owner Lee")],
      ["docx", () => docx()],
    ] as const)(
      "real %s attachment result persists, deletes raw files and never indexes",
      async (format, bytes) => {
        const before = await sharedCounts();
        const f = await upload("private." + format, bytes());
        const row = await owner.attachment.findUniqueOrThrow({
          where: { id: f.id },
        });
        expect(
          (
            await stat(
              path.join(
                process.env.TOWNBASE_ATTACHMENTS_PATH!,
                "temporary",
                row.storageKey,
              ),
            )
          ).mode & 0o777,
        ).toBe(0o600);
        const body = task(f.id);
        const r = await call("post", "/attachment-tasks")
          .send(body)
          .expect(200);
        expect(r.body).toMatchObject({
          status: "answered",
          model: "gpt-6-luna",
          reattachRequired: true,
        });
        expect(r.body.sources[0]).toMatchObject({
          kind: "attachment",
          attachmentId: f.id,
        });
        expect(await sharedCounts()).toEqual(before);
        expect(provider.call).toHaveBeenCalledTimes(1);
        expect(provider.call.mock.calls[0]![1].model).toBe("gpt-6-luna");
        const deleted = await owner.attachment.findUniqueOrThrow({
          where: { id: f.id },
        });
        expect(deleted.blockedAt).not.toBeNull();
        expect(deleted.rawDeletedAt).not.toBeNull();
        expect(
          await readdir(
            path.join(process.env.TOWNBASE_ATTACHMENTS_PATH!, "temporary"),
          ),
        ).not.toContain(row.storageKey);
        const read = await call(
          "get",
          "/attachment-tasks/" + body.requestId,
        ).expect(200);
        expect(read.body.answer).toBe(r.body.answer);
        const duplicate = await call("post", "/attachment-tasks")
          .send(body)
          .expect(200);
        expect(duplicate.body.answer).toBe(r.body.answer);
        expect(provider.call).toHaveBeenCalledTimes(1);
        await call("post", "/attachment-tasks").send(task(f.id)).expect(409);
        await app.close();
        await start();
        await login();
        expect(
          (await call("get", "/attachment-tasks/" + body.requestId).expect(200))
            .body.answer,
        ).toBe(r.body.answer);
      },
    );
    test("mixed retrieval embeds only separately entered question, with no attachment contamination", async () => {
      const f = await upload();
      const before = await sharedCounts();
      const search = jest.spyOn(app.get(FileIndexService), "search");
      const r = await (async () => {
        try {
          const result = await call("post", "/attachment-tasks")
            .send(task(f.id, { ragQuestion: "배송 절차를 알려줘" }))
            .expect(200);
          expect(search).toHaveBeenCalledTimes(1);
          expect(search.mock.calls[0]![4]).toMatchObject({
            question: "배송 절차를 알려줘",
          });
          return result;
        } finally {
          search.mockRestore();
        }
      })();
      expect(r.body.status).toBe("answered");
      expect(
        r.body.sources.some((s: { kind: string }) => s.kind === "rag"),
      ).toBe(false); // The synthetic answer cites only its attachment; unused context is not presented as evidence.
      expect(r.body.contextSourceCount).toBeGreaterThan(r.body.sources.length);
      const embedding = provider.call.mock.calls.filter(
        ([, r]) => r.model === "text-embedding-3-small",
      );
      expect(embedding).toHaveLength(1);
      expect(embedding[0]![1].input).toBe("배송 절차를 알려줘");
      expect(await sharedCounts()).toEqual(before);
      const next = await upload();
      await call("post", "/attachment-tasks")
        .send(
          task(next.id, {
            historyRequestIds: [r.body.requestId],
            question: "이를 공용 검색에 써줘",
          }),
        )
        .expect(200);
      expect(
        provider.call.mock.calls.filter(
          ([, r]) => r.model === "text-embedding-3-small",
        ),
      ).toHaveLength(1);
      expect(await sharedCounts()).toEqual(before);
    });
    test.each(["refusal", "invalid", "outage"] as const)(
      "private %s never produces shared Gap or draft",
      async (state) => {
        variant = state;
        const before = await sharedCounts();
        const f = await upload();
        const r = await call("post", "/attachment-tasks")
          .send(task(f.id))
          .expect(200);
        expect(r.body.status).toBe(state === "refusal" ? "refused" : "failed");
        expect(await sharedCounts()).toEqual(before);
        expect(
          (await owner.attachment.findUniqueOrThrow({ where: { id: f.id } }))
            .rawDeletedAt,
        ).not.toBeNull();
      },
    );
    test("blocks policy, corrupted/oversized context, secrets and invalid file before successful result", async () => {
      const f = await upload();
      const fresh = await login();
      const changed = await app
        .get(ModelIntegrationService)
        .setTransfers(token, password, fresh, {
          documentEmbedding: true,
          rag: true,
          attachment: false,
        });
      expect(changed.ok).toBe(true);
      const denied = await call("post", "/attachment-tasks")
        .send(task(f.id))
        .expect(200);
      expect(denied.body).toMatchObject({
        status: "failed",
        errorCode: "transfer_not_allowed",
      });
      expect(provider.call).not.toHaveBeenCalled();
      await configureModel();
      const big = await upload("big.txt", Buffer.from("x".repeat(9000)));
      const contextLimit = await call("post", "/attachment-tasks")
        .send(task(big.id))
        .expect(200);
      expect(contextLimit.body.errorCode).toBe("attachment_context_limit");
      const broken = await upload("broken.pdf", Buffer.from("not pdf"));
      const parse = await call("post", "/attachment-tasks")
        .send(task(broken.id))
        .expect(200);
      expect(parse.body.errorCode).toBe("invalid_format");
      await call("post", "/attachments")
        .send({
          name: "secret.txt",
          contentBase64: Buffer.from(
            "-----BEGIN PRIVATE KEY-----\ncanary",
          ).toString("base64"),
        })
        .expect(403);
    });
    test("expiry/restart deletes unused raw and interrupts tasks without replaying paid calls", async () => {
      const f = await upload();
      const row = await owner.attachment.findUniqueOrThrow({
        where: { id: f.id },
      });
      await owner.attachment.update({
        where: { id: f.id },
        data: {
          createdAt: new Date(Date.now() - 3601000),
          expiresAt: new Date(Date.now() - 1000),
        },
      });
      await app.close();
      await start();
      await login();
      const cleaned = await owner.attachment.findUnique({
        where: { id: f.id },
      });
      expect(cleaned == null || cleaned.rawDeletedAt != null).toBe(true);
      expect(
        await readdir(
          path.join(process.env.TOWNBASE_ATTACHMENTS_PATH!, "temporary"),
        ),
      ).not.toContain(row.storageKey);
      await call("post", "/attachment-tasks").send(task(f.id)).expect(409);
      expect(provider.call).not.toHaveBeenCalled();
    });
    test("RAG and attachment tasks share admission and retain duplicate request identity", async () => {
      const f = await upload();
      let release!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      hold = async () => gate;
      const body = task(f.id);
      const pending = call("post", "/attachment-tasks")
        .send(body)
        .then((r) => r);
      for (let i = 0; i < 100 && provider.call.mock.calls.length === 0; i++)
        await new Promise((r) => setTimeout(r, 10));
      expect(provider.call).toHaveBeenCalledTimes(1);
      await ask(input()).expect(429);
      const duplicate = await call("post", "/attachment-tasks")
        .send(body)
        .expect(202);
      expect(duplicate.body.requestId).toBe(body.requestId);
      release();
      expect((await pending).body.status).toBe("answered");
    });
    test("explicit private result and RAG conversation deletion persist separate replay intents", async () => {
      const f = await upload();
      const body = task(f.id);
      await call("post", "/attachment-tasks").send(body).expect(200);
      await call("delete", "/attachment-tasks/" + body.requestId)
        .send({})
        .expect(200);
      await call("get", "/attachment-tasks/" + body.requestId).expect(404);
      const r = await ask().expect(200);
      await call("delete", "/rag/conversations/" + r.body.conversationId)
        .send({})
        .expect(200);
      await call("get", "/rag/questions/" + r.body.requestId).expect(404);
      const records = await app.get(DeletionJournal).records();
      expect(
        records.some(
          (r) => r.kind === "private_result" && r.targetId === body.requestId,
        ),
      ).toBe(true);
      expect(
        records.some(
          (record) =>
            record.kind === "conversation" &&
            record.targetId === r.body.conversationId,
        ),
      ).toBe(true);
    });
    test("encrypted attachment and aggregate file limits never dispatch", async () => {
      const encrypted = await upload("encrypted.pdf", encryptedPdf());
      const result = await call("post", "/attachment-tasks")
        .send(task(encrypted.id))
        .expect(200);
      expect(result.body.errorCode).toBe("encrypted_file");
      expect(provider.call).not.toHaveBeenCalled();
      const a = await upload("a.txt", Buffer.alloc(10 * 1024 * 1024, 65));
      const b = await upload("b.txt", Buffer.alloc(10 * 1024 * 1024, 66));
      const c = await upload("c.txt", Buffer.from("c"));
      await call("post", "/attachment-tasks")
        .send(task(a.id, { attachmentIds: [a.id, b.id, c.id] }))
        .expect(413);
      expect(provider.call).not.toHaveBeenCalled();
      await call("post", "/attachments")
        .send({
          name: "too-large.txt",
          contentBase64: Buffer.alloc(10 * 1024 * 1024 + 1, 65).toString(
            "base64",
          ),
        })
        .expect(413);
    });
    test("attachment envelope overflow has the same file limit code and releases the upload slot", async () => {
      const before = await owner.attachment.count();
      const response = await call("post", "/ATTACHMENTS/")
        .send({
          name: "oversized.txt",
          contentBase64: Buffer.alloc(11 * 1024 * 1024, 0x61).toString(
            "base64",
          ),
        })
        .expect(413);
      expect(response.body.code).toBe("file_too_large");
      expect(await owner.attachment.count()).toBe(before);
      expect(provider.call).not.toHaveBeenCalled();
      const next = await upload();
      expect(next.id).toBeTruthy();
    });
    test("private tasks enforce auth, limits, UUID and exact body aliases", async () => {
      await request(app.getHttpServer())
        .post("/attachments")
        .set({
          Host: "127.0.0.1:3000",
          Origin: "http://127.0.0.1:3000",
          "X-Townbase-Auth": "1",
        })
        .send({})
        .expect(401);
      const f = await upload();
      await call("post", "/attachment-tasks")
        .send(task(f.id, { attachmentIds: [f.id, f.id] }))
        .expect(400);
      await call("post", "/attachment-tasks")
        .send(task(f.id, { workspaceId: "foreign" }))
        .expect(403);
      await call("post", "/attachment-tasks")
        .send(
          task(f.id, {
            attachmentIds: [f.id, randomUUID(), randomUUID(), randomUUID()],
          }),
        )
        .expect(400);
      const r = await call("post", "/ATTACHMENT-TASKS/")
        .send(task(f.id))
        .expect(200);
      expect(r.body.status).toBe("answered");
      await call("get", "/attachment-tasks/" + randomUUID()).expect(404);
      await call("delete", "/attachments/" + f.id)
        .send({})
        .expect(409);
    });
    test("chat list exposes only a safe title, sorts by latest activity and hides invalid source titles", async () => {
      const first = (
        await ask(input({ question: "배송 절차를 알려줘" })).expect(200)
      ).body;
      const second = (
        await ask(input({ question: "배송 담당을 알려줘" })).expect(200)
      ).body;
      await ask(
        input({
          conversationId: first.conversationId,
          question: "배송 절차를 다시 알려줘",
        }),
      ).expect(200);
      const list = (await call("get", "/rag/conversations").expect(200)).body;
      expect(list.conversations.map((c: { id: string }) => c.id)).toEqual([
        first.conversationId,
        second.conversationId,
      ]);
      expect(list.conversations[0].title).toBe("배송 절차를 알려줘");
      expect(Object.keys(list.conversations[0]).sort()).toEqual([
        "createdAt",
        "id",
        "title",
        "updatedAt",
      ]);
      await owner.fileOriginal.update({
        where: { id: originalId },
        data: { excludedAt: new Date() },
      });
      const hidden = (await call("get", "/rag/conversations").expect(200)).body;
      expect(
        hidden.conversations.every(
          (c: { title: string }) => c.title === "근거가 변경된 대화",
        ),
      ).toBe(true);
      await call("get", "/rag/conversations?cursor=" + randomUUID()).expect(
        400,
      );
    });
    test("latest chat messages paginate backwards without losing timestamp ties or exposing other chats", async () => {
      const response = (await ask().expect(200)).body;
      const base = await owner.ragTurn.findUniqueOrThrow({
        where: {
          installationId_requestId: {
            installationId: "primary",
            requestId: response.requestId,
          },
        },
      });
      for (let i = 0; i < 24; i++) {
        const at = new Date(
          base.createdAt.getTime() - 1000 * (1 + Math.floor(i / 3)),
        );
        await owner.ragTurn.create({
          data: {
            ...base,
            modelOptions:
              base.modelOptions == null
                ? Prisma.DbNull
                : (base.modelOptions as Prisma.InputJsonValue),
            requestId: randomUUID(),
            embeddingRequestId: randomUUID(),
            answerRequestId: randomUUID(),
            question: "이전 질문 " + i,
            createdAt: at,
            deadlineAt: new Date(at.getTime() + 90000),
            completedAt: new Date(at.getTime() + 100),
            expiresAt: new Date(at.getTime() + 30 * 86400000),
            sources: base.sources as Prisma.InputJsonValue,
            result: base.result as Prisma.InputJsonValue,
          },
        });
      }
      const first = (
        await call(
          "get",
          `/rag/conversations/${response.conversationId}/turns?order=latest`,
        ).expect(200)
      ).body;
      expect(first.turns).toHaveLength(20);
      expect(first.turns.at(-1).requestId).toBe(response.requestId);
      const previous = (
        await call(
          "get",
          `/rag/conversations/${response.conversationId}/turns?order=latest&cursor=${first.nextCursor}`,
        ).expect(200)
      ).body;
      expect(previous.turns).toHaveLength(5);
      expect(previous.nextCursor).toBeNull();
      expect(
        new Set(
          [...first.turns, ...previous.turns].map(
            (t: { requestId: string }) => t.requestId,
          ),
        ).size,
      ).toBe(25);
      await call(
        "get",
        `/rag/conversations/${response.conversationId}/turns?order=latest&cursor=${randomUUID()}`,
      ).expect(400);
      await call(
        "get",
        `/rag/conversations/${response.conversationId}/turns?order=invalid`,
      ).expect(400);
    });
    test("attachment navigation loads metadata separately from private result bodies", async () => {
      const file = await upload();
      const response = await call("post", "/attachment-tasks")
        .send(task(file.id))
        .expect(200);
      const list = (
        await call("get", "/attachment-tasks?view=summary").expect(200)
      ).body;
      expect(list.tasks).toHaveLength(1);
      expect(list.tasks[0].requestId).toBe(response.body.requestId);
      expect(Object.keys(list.tasks[0]).sort()).toEqual([
        "createdAt",
        "requestId",
        "status",
        "title",
      ]);
      expect(JSON.stringify(list)).not.toContain("ATTACH-ONLY-OPS-731");
      expect(
        JSON.stringify(
          (
            await call(
              "get",
              "/attachment-tasks/" + response.body.requestId,
            ).expect(200)
          ).body.result,
        ),
      ).toContain("ATTACH-ONLY-OPS-731");
      await call("get", "/attachment-tasks?view=invalid").expect(400);
    });
    test("stopping a RAG response cancels actual work, preserves charges and blocks late publication", async () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      hold = async (r) => {
        if (r.model !== "text-embedding-3-small") await gate;
      };
      const body = input();
      const pending = ask(body).then((r) => r);
      try {
        for (let i = 0; i < 200 && provider.call.mock.calls.length < 2; i++)
          await new Promise((r) => setTimeout(r, 10));
        expect(provider.call).toHaveBeenCalledTimes(2);
        await call("post", "/rag/questions/" + body.requestId + "/stop")
          .send({ unexpected: true })
          .expect(400);
        const stopped = await call(
          "post",
          "/rag/questions/" + body.requestId + "/stop",
        )
          .send({})
          .expect(201);
        expect(stopped.body.status).toBe("interrupted");
        expect(stopped.body.errorCode).toBe("operator_stopped");
        expect((await pending).body.status).toBe("interrupted");
        release();
        for (let i = 0; i < 100; i++) {
          const cost = await owner.modelCall.findFirst({
            where: { purpose: "rag_answer", installationId: "primary" },
          });
          if (cost?.status === "unknown") {
            expect(cost.chargedNanoUsd).toBeNull();
            expect(cost.reservedNanoUsd > 0n).toBe(true);
            break;
          }
          await new Promise((r) => setTimeout(r, 10));
        }
        const finalCost = await owner.modelCall.findFirst({
          where: { purpose: "rag_answer", installationId: "primary" },
        });
        expect(finalCost?.status).toBe("unknown");
        expect(finalCost?.chargedNanoUsd).toBeNull();
        expect(finalCost!.reservedNanoUsd > 0n).toBe(true);
        const read = (
          await call("get", "/rag/questions/" + body.requestId).expect(200)
        ).body;
        expect(read.answer).toBeNull();
        expect(
          read.calls.some((c: { status: string }) => c.status === "unknown"),
        ).toBe(true);
        await ask(body).expect(200);
        expect(provider.call).toHaveBeenCalledTimes(2);
        await call("post", "/rag/questions/" + randomUUID() + "/stop")
          .send({})
          .expect(404);
      } finally {
        release();
        await pending;
      }
    });
    test("private list deadlines and UUID history use the same chronological contract", async () => {
      const file = await upload();
      const response = await call("post", "/attachment-tasks")
        .send(task(file.id))
        .expect(200);
      const base = await owner.attachmentTask.findUniqueOrThrow({
        where: {
          installationId_requestId: {
            installationId: "primary",
            requestId: response.body.requestId,
          },
        },
      });
      await owner.attachment.deleteMany();
      await owner.attachmentTask.deleteMany();
      const ids = Array.from(
        { length: 25 },
        (_, i) =>
          `${(1000 - i).toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`,
      );
      const now = Date.now();
      for (let i = 0; i < ids.length; i++)
        await owner.attachmentTask.create({
          data: {
            ...base,
            modelOptions:
              base.modelOptions == null
                ? Prisma.DbNull
                : (base.modelOptions as Prisma.InputJsonValue),
            requestId: ids[i]!,
            fingerprint: i.toString(16).padStart(64, "0"),
            createdAt: new Date(now - 10000 + i * 10),
            deadlineAt: new Date(now - 1000),
            status: i === 0 ? "running" : "answered",
            completedAt: i === 0 ? null : base.completedAt,
            result:
              i === 0 ? Prisma.DbNull : (base.result as Prisma.InputJsonValue),
            ragSources: base.ragSources as Prisma.InputJsonValue,
            attachmentSources: base.attachmentSources as Prisma.InputJsonValue,
            answer: i === 0 ? null : base.answer,
            errorCode: null,
            model: i === 0 ? null : base.model,
          },
        });
      const first = (await call("get", "/attachment-tasks").expect(200)).body;
      const second = (
        await call(
          "get",
          "/attachment-tasks?cursor=" + first.nextCursor,
        ).expect(200)
      ).body;
      expect(
        [...first.tasks, ...second.tasks].map(
          (r: { requestId: string }) => r.requestId,
        ),
      ).toEqual(ids);
      const summary = (
        await call("get", "/attachment-tasks?view=summary").expect(200)
      ).body;
      const overdue = await call("get", "/attachment-tasks/" + ids[0]).expect(
        200,
      );
      const oldestPage = (
        await call(
          "get",
          "/attachment-tasks?view=summary&cursor=" + summary.nextCursor,
        ).expect(200)
      ).body;
      expect(
        oldestPage.tasks.find(
          (r: { requestId: string }) => r.requestId === ids[0],
        ).status,
      ).toBe(overdue.body.status);
      expect(overdue.body.status).toBe("interrupted");
      await call("get", "/attachment-tasks?cursor=" + randomUUID()).expect(404);
    });
    test("a DB-rejected durable deletion blocks live reads until clean startup replay", async () => {
      await owner.$executeRawUnsafe(
        `CREATE FUNCTION public.pr48_reject_deletion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."deletedAt" IS NOT NULL THEN RAISE EXCEPTION 'synthetic deletion failure'; END IF; RETURN NEW; END $$`,
      );
      await owner.$executeRawUnsafe(
        `CREATE TRIGGER pr48_deletion_failure BEFORE UPDATE OF "deletedAt" ON "FileOriginal" FOR EACH ROW EXECUTE FUNCTION public.pr48_reject_deletion()`,
      );
      try {
        await call("delete", "/files/" + secondOriginalId)
          .send({})
          .expect(503);
        expect(
          (
            await owner.fileOriginal.findUniqueOrThrow({
              where: { id: secondOriginalId },
            })
          ).deletedAt,
        ).toBeNull();
        await call("get", "/files/" + secondOriginalId).expect(503);
        await call("get", "/rag/conversations").expect(503);
        await call("get", "/readyz").expect(503);
      } finally {
        await owner.$executeRawUnsafe(
          `DROP TRIGGER pr48_deletion_failure ON "FileOriginal"`,
        );
        await owner.$executeRawUnsafe(
          `DROP FUNCTION public.pr48_reject_deletion()`,
        );
      }
      await app.close();
      await start();
      await login();
      await call("get", "/files/" + secondOriginalId).expect(404);
      expect(
        (
          await owner.fileOriginal.findUniqueOrThrow({
            where: { id: secondOriginalId },
          })
        ).deletedAt,
      ).not.toBeNull();
    });
    test("deletion intent replays after simulated old DB restore before new reads", async () => {
      const version = await owner.fileVersion.findFirstOrThrow({
        where: { originalId },
        orderBy: { version: "desc" },
      });
      const originalPath = path.join(
        process.env.TOWNBASE_DOCUMENTS_PATH!,
        "originals",
        version.storageKey,
      );
      const originalBytes = await readFile(originalPath);
      const answered = await ask().expect(200);
      await call("delete", "/files/" + originalId)
        .send({})
        .expect(200);
      const records = await app.get(DeletionJournal).records();
      await call("delete", "/files/" + originalId)
        .send({})
        .expect(200);
      expect((await app.get(DeletionJournal).records()).length).toBe(
        records.length,
      );
      expect(
        await owner.installationAuditEvent.count({
          where: { action: "file_deleted", requestId: originalId },
        }),
      ).toBe(1);
      expect(
        records.some((r) => r.kind === "file" && r.targetId === originalId),
      ).toBe(true);
      await owner.fileOriginal.update({
        where: { id: originalId },
        data: { deletedAt: null },
      });
      await owner.fileVersion.update({
        where: { id: version.id },
        data: {
          extraction: version.extraction as Prisma.InputJsonValue,
          rawDeletedAt: null,
        },
      });
      await writeFile(originalPath, originalBytes, { mode: 0o600 });
      await app.close();
      await start();
      await login();
      await call("get", "/files/" + originalId).expect(404);
      const hidden = await call(
        "get",
        "/rag/questions/" + answered.body.requestId,
      ).expect(200);
      expect(hidden.body).toMatchObject({
        answer: null,
        sourceState: "unavailable",
      });
    });
  },
);
