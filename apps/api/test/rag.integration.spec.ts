import "reflect-metadata";
import { createRequire } from "node:module";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@townbase/database";
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
const { FileRunService } = built(
  "../dist/files/file-run.service",
) as typeof import("../src/files/file-run.service");
const { CredentialVault } = built(
  "../dist/model-integration/credential-vault",
) as typeof import("../src/model-integration/credential-vault");
const { RagStore } = built(
  "../dist/rag/rag-store",
) as typeof import("../src/rag/rag-store");
const { PRICE_VERSION } = built(
  "../dist/model-integration/model-policy",
) as typeof import("../src/model-integration/model-policy");
const { hashPassword } = built(
  "../dist/setup/password",
) as typeof import("../src/setup/password");
const integration =
  process.env.TOWNBASE_RAG_TEST === "1" ? describe : describe.skip;

integration(
  "E02-E05 persisted document Agent, synthetic provider and actual restricted DB",
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
        attachment: false,
      });
    }
    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL!);
      if (url.hostname !== "postgres" || url.pathname !== "/townbase_e02_test")
        throw new Error("Dedicated RAG DB required");
      owner = new PrismaClient({
        datasources: { db: { url: url.toString() } },
      });
      await assertFreshFileManagementDatabase(owner);
      if ((await owner.ragConversation.count()) || (await owner.ragGap.count()))
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
          purpose: { in: ["rag_answer", "rag_question_embedding"] },
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
    test("answers from actual file content, persists citations/calls and reads the same result after restart", async () => {
      const body = input({ question: "왜 배송 절차가 변경됐어?" });
      const response = await ask(body)
        .expect(200)
        .expect("Cache-Control", "no-store");
      expect(response.body).toMatchObject({
        requestId: body.requestId,
        status: "answered",
        isAnswerable: true,
        resolvedMode: "product_history",
        model: "gpt-6-luna",
      });
      expect(response.body.sources[0]).toMatchObject({
        originalId,
        sourceType: "uploaded_file",
        requestedMode: "auto",
        resolvedMode: "product_history",
        scopeRevision: 1,
      });
      expect(response.body.sources[0].locations[0].location.lineStart).toBe(1);
      const answerRequest = provider.call.mock.calls.find(
        ([, r]) => r.model === "gpt-6-luna",
      )![1];
      expect(JSON.parse(answerRequest.input).sources[0].content).toContain(
        "배송은 주문 확인",
      );
      expect(answerRequest.instructions).toContain("chronology");
      expect(response.body.calls).toHaveLength(2);
      expect(
        response.body.calls.every(
          (c: { chargedUsd: string | null; usage: unknown }) =>
            c.chargedUsd !== null && c.usage !== null,
        ),
      ).toBe(true);
      expect(await owner.ragGap.count()).toBe(0);
      await app.close();
      await start();
      const reread = await call(
        "get",
        `/rag/questions/${body.requestId}`,
      ).expect(200);
      expect(reread.body).toEqual(response.body);
      const list = await call(
        "get",
        `/rag/conversations/${response.body.conversationId}/turns`,
      ).expect(200);
      expect(list.body.turns[0]).toEqual(response.body);
    });
    test("case-insensitive request UUID never repeats paid work; changed payload conflicts", async () => {
      const body = input();
      await ask(body).expect(200);
      const count = provider.call.mock.calls.length;
      await ask({ ...body, requestId: body.requestId.toUpperCase() }).expect(
        200,
      );
      expect(provider.call).toHaveBeenCalledTimes(count);
      await ask({ ...body, question: "다른 질문" }).expect(409);
      expect(await owner.ragTurn.count()).toBe(1);
    });
    test("weak retrieval saves a real Gap, has no answer-model call, and supports explicit Gap deletion", async () => {
      const response = await ask(input({ question: "알수없음 질문" })).expect(
        200,
      );
      expect(response.body).toMatchObject({
        status: "refused",
        isAnswerable: false,
        model: null,
      });
      expect(response.body.gapId).toEqual(expect.any(String));
      expect(
        provider.call.mock.calls.every(
          ([, r]) => r.model === "text-embedding-3-small",
        ),
      ).toBe(true);
      const gaps = await call("get", "/rag/gaps").expect(200);
      expect(gaps.body.gaps[0].id).toBe(response.body.gapId);
      expect(await owner.ragGap.count()).toBe(1);
      await call("delete", `/rag/gaps/${response.body.gapId}`)
        .send({})
        .expect(200);
      expect(await owner.ragGap.count()).toBe(0);
    });
    test("unresolved conflicting documents retain both exact citations with refusal and Gap", async () => {
      await owner.basicAgent.update({
        where: { installationId: "primary" },
        data: { sourceOriginalIds: [originalId, secondOriginalId] },
      });
      variant = "conflict";
      const r = await ask().expect(200);
      expect(r.body).toMatchObject({ status: "refused", isAnswerable: false });
      expect(r.body.sources).toHaveLength(2);
      expect(
        new Set(
          r.body.sources.map((s: { originalId: string }) => s.originalId),
        ),
      ).toEqual(new Set([originalId, secondOriginalId]));
      expect(r.body.answer).toContain("문서 간 충돌");
      expect(r.body.gapId).toEqual(expect.any(String));
    });
    test("model refusal is persisted with Gap in the same completion transaction", async () => {
      variant = "refusal";
      const r = await ask().expect(200);
      expect(r.body).toMatchObject({ status: "refused", isAnswerable: false });
      expect(
        await owner.ragGap.findUnique({ where: { id: r.body.gapId } }),
      ).toMatchObject({ turnRequestId: r.body.requestId });
    });
    test.each(["invalid", "incomplete", "outage"] as const)(
      "separates %s provider failure from document gaps",
      async (kind) => {
        variant = kind;
        const body = input();
        const r = await ask(body).expect(200);
        expect(r.body.status).toBe("failed");
        expect(r.body.answer).toBeNull();
        expect(r.body.isAnswerable).toBeNull();
        expect(await owner.ragGap.count()).toBe(0);
        const charged = await owner.modelCall.findMany({
          where: { purpose: "rag_answer" },
        });
        expect(charged[0]!.status).toBe(
          kind === "outage"
            ? "unknown"
            : kind === "incomplete"
              ? "incomplete"
              : "succeeded",
        );
        if (kind === "outage") {
          expect(charged[0]!.chargedNanoUsd).toBeNull();
          expect(charged[0]!.reservedNanoUsd > 0n).toBe(true);
        }
        const count = provider.call.mock.calls.length;
        await ask(body).expect(200);
        expect(provider.call).toHaveBeenCalledTimes(count);
      },
    );
    test("disabled RAG transfer and missing budget stop before network and create no Gap", async () => {
      await owner.modelTransferPolicy.update({
        where: { installationId: "primary" },
        data: { rag: false },
      });
      const denied = await ask().expect(200);
      expect(denied.body).toMatchObject({
        status: "failed",
        errorCode: "transfer_not_allowed",
      });
      expect(provider.call).not.toHaveBeenCalled();
      await owner.modelTransferPolicy.update({
        where: { installationId: "primary" },
        data: { rag: true },
      });
      await owner.modelExecutionSettings.update({
        where: { installationId: "primary" },
        data: { monthlyBudgetNanoUsd: null },
      });
      const budget = await ask().expect(200);
      expect(budget.body.errorCode).toBe("budget_not_configured");
      expect(provider.call).not.toHaveBeenCalled();
      expect(await owner.ragGap.count()).toBe(0);
    });
    test("raw secret patterns are blocked before persistence/transmission even through JSON fields", async () => {
      const before = await owner.ragTurn.count();
      await ask(input({ question: "API_KEY=super-private-value" })).expect(403);
      expect(await owner.ragTurn.count()).toBe(before);
      expect(provider.call).not.toHaveBeenCalled();
      await owner.basicAgent.update({
        where: { installationId: "primary" },
        data: { instructions: "운영 설정\nAPI_KEY=super-private-value" },
      });
      const r = await ask().expect(200);
      expect(r.body).toMatchObject({
        status: "failed",
        errorCode: "sensitive_content",
      });
      expect(provider.call).not.toHaveBeenCalled();
      expect(await owner.ragGap.count()).toBe(0);
    });
    test("explicit history is reloaded in the same owned conversation and never embedded", async () => {
      const first = await ask().expect(200);
      provider.call.mockClear();
      const body = input({
        question: "그 절차를 다시 알려줘",
        conversationId: first.body.conversationId,
        historyRequestIds: [first.body.requestId],
      });
      const followup = await ask(body).expect(200);
      expect(followup.body.status).toBe("answered");
      const timeline = await call(
        "get",
        `/rag/conversations/${first.body.conversationId}/turns`,
      ).expect(200);
      expect(
        timeline.body.turns.map((t: { requestId: string }) => t.requestId),
      ).toEqual([first.body.requestId, followup.body.requestId]);
      const next = await call(
        "get",
        `/rag/conversations/${first.body.conversationId}/turns?cursor=${first.body.requestId}`,
      ).expect(200);
      expect(
        next.body.turns.map((t: { requestId: string }) => t.requestId),
      ).toEqual([followup.body.requestId]);
      const embedding = provider.call.mock.calls.find(
        ([, r]) => r.model === "text-embedding-3-small",
      )![1];
      expect(embedding.input).toBe(body.question);
      const answer = provider.call.mock.calls.find(
        ([, r]) => r.model === "gpt-6-luna",
      )![1];
      expect(JSON.parse(answer.input).history[0].answer).toBe(
        first.body.answer,
      );
      await ask(
        input({
          conversationId: randomUUID(),
          historyRequestIds: [first.body.requestId],
        }),
      ).expect(404);
    });
    test("source exclusion during answer blocks publication and masks prior answer/Gap content", async () => {
      const prior = await ask().expect(200);
      variant = "refusal";
      const gap = await ask().expect(200);
      variant = "normal";
      let release!: () => void, entered!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve)),
        reached = new Promise<void>((resolve) => (entered = resolve));
      hold = async (r) => {
        if (r.model !== "text-embedding-3-small") {
          entered();
          await gate;
        }
      };
      const running = ask().then((r) => r);
      await reached;
      await call("put", `/files/${originalId}/scope`)
        .send({ included: false })
        .expect(200);
      release();
      const r = await running;
      expect(r.body.status).toBe("failed");
      expect(r.body.answer).toBeNull();
      const hidden = await call(
        "get",
        `/rag/questions/${prior.body.requestId}`,
      ).expect(200);
      expect(hidden.body).toMatchObject({
        sourceState: "unavailable",
        question: null,
        answer: null,
        sources: [],
      });
      const gaps = await call("get", "/rag/gaps").expect(200);
      expect(
        gaps.body.gaps.find((g: { id: string }) => g.id === gap.body.gapId),
      ).toMatchObject({
        sourceState: "unavailable",
        question: null,
        reason: null,
      });
      const callsBeforeHistory = provider.call.mock.calls.length;
      await ask(
        input({
          conversationId: prior.body.conversationId,
          historyRequestIds: [prior.body.requestId],
        }),
      ).expect(409);
      expect(provider.call).toHaveBeenCalledTimes(callsBeforeHistory);
      await call("put", `/files/${originalId}/scope`)
        .send({ included: true })
        .expect(200);
      expect(
        (
          await call("get", `/rag/questions/${prior.body.requestId}`).expect(
            200,
          )
        ).body.answer,
      ).toBeNull();
    });
    test("Agent change during master-key preparation blocks the answer before reservation", async () => {
      const vault = app.get(CredentialVault),
        original = vault.prepareReader.bind(vault);
      let reads = 0;
      jest.spyOn(vault, "prepareReader").mockImplementation(async () => {
        const reader = await original();
        if (++reads === 2)
          await owner.basicAgent.update({
            where: { installationId: "primary" },
            data: { revision: { increment: 1 } },
          });
        return reader;
      });
      const r = await ask().expect(200);
      expect(r.body).toMatchObject({
        status: "failed",
        errorCode: "agent_changed",
      });
      expect(provider.call).toHaveBeenCalledTimes(1);
      expect(
        await owner.modelCall.count({ where: { purpose: "rag_answer" } }),
      ).toBe(0);
    });
    test("model settings change during network blocks result publication", async () => {
      let changed = false;
      hold = async (r) => {
        if (r.model === "gpt-6-luna" && !changed) {
          changed = true;
          await owner.modelExecutionSettings.update({
            where: { installationId: "primary" },
            data: { outputTokenLimit: 2048 },
          });
        }
      };
      const r = await ask().expect(200);
      expect(r.body).toMatchObject({
        status: "failed",
        errorCode: "model_settings_changed",
        answer: null,
      });
      expect(await owner.ragGap.count()).toBe(0);
    });
    test("overlapping duplicate returns running, other work is busy, and late timeout results never publish", async () => {
      let release!: () => void, entered!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve)),
        reached = new Promise<void>((resolve) => (entered = resolve));
      hold = async (r) => {
        if (r.model === "gpt-6-luna") {
          entered();
          await gate;
        }
      };
      const body = input(),
        running = ask(body).then((r) => r);
      await reached;
      const duplicate = await ask(body).expect(202);
      expect(duplicate.body.status).toBe("running");
      await ask().expect(429);
      const now = Date.now();
      await owner.ragTurn.update({
        where: {
          installationId_requestId: {
            installationId: "primary",
            requestId: body.requestId,
          },
        },
        data: {
          createdAt: new Date(now - 120_000),
          deadlineAt: new Date(now - 1000),
        },
      });
      await app.get(RagStore).maintenance();
      release();
      const r = await running;
      expect(r.body).toMatchObject({
        status: "interrupted",
        errorCode: "question_timeout",
        answer: null,
      });
      expect(await owner.ragGap.count()).toBe(0);
    });
    test("Gap failure rolls back terminal publication while keeping paid usage observable", async () => {
      variant = "refusal";
      await owner.$executeRaw`ALTER TABLE "RagGap" ADD CONSTRAINT "RAG_reject_gap" CHECK (false)`;
      try {
        const r = await ask().expect(200);
        expect(r.body).toMatchObject({ status: "failed", answer: null });
        expect(
          r.body.calls.some(
            (c: { chargedUsd: string | null }) => c.chargedUsd !== null,
          ),
        ).toBe(true);
        expect(await owner.ragGap.count()).toBe(0);
      } finally {
        await owner.$executeRaw`ALTER TABLE "RagGap" DROP CONSTRAINT "RAG_reject_gap"`;
      }
    });
    test("expired turns disappear, Gap remains, and the old paid request UUID cannot be reused", async () => {
      const body = input({ question: "알수없음 질문" }),
        r = await ask(body).expect(200);
      const old = Date.now() - 31 * 24 * 3600_000;
      await owner.ragTurn.update({
        where: {
          installationId_requestId: {
            installationId: "primary",
            requestId: body.requestId,
          },
        },
        data: {
          createdAt: new Date(old),
          deadlineAt: new Date(old + 90000),
          expiresAt: new Date(Date.now() - 1000),
        },
      });
      await app.get(RagStore).maintenance();
      await call("get", `/rag/questions/${body.requestId}`).expect(404);
      await ask(body).expect(409);
      expect((await call("get", "/rag/gaps").expect(200)).body.gaps[0].id).toBe(
        r.body.gapId,
      );
    });
    test("question rate includes local refusals, and count resets only with the rolling window", async () => {
      for (let i = 0; i < 10; i++)
        await ask(input({ question: "알수없음 질문" })).expect(200);
      await ask().expect(429);
      expect(await owner.ragTurn.count()).toBe(10);
    });
    test("actual transport supports the Unicode question envelope and rejects oversized, compressed and untrusted inputs", async () => {
      await call("post", "/RAG/QUESTIONS/")
        .send(input({ question: "가".repeat(4000) }))
        .expect(200);
      const bytes = await call("post", "/rag/questions")
        .send(input({ question: "x".repeat(70000) }))
        .expect(413);
      expect(bytes.body.code).toBe("invalid_json");
      await call("post", "/rag/questions")
        .set("Content-Encoding", "gzip")
        .send(input())
        .expect(415);
      await ask(input({ attachmentId: randomUUID() })).expect(400);
      await call("post", "/rag/questions")
        .set("Origin", "https://evil.example")
        .send(input())
        .expect(403);
      await call("post", "/rag/questions")
        .set("Cookie", "")
        .send(input())
        .expect(401);
      await call("get", "/rag/gaps")
        .set("X-Workspace-Id", "foreign")
        .expect(403);
      await call("post", "/rag/questions").type("text").send("{}").expect(415);
    });
    test("corrupt saved evidence is rejected before historical content is returned", async () => {
      const r = await ask().expect(200);
      const row = await owner.ragTurn.findUniqueOrThrow({
        where: {
          installationId_requestId: {
            installationId: "primary",
            requestId: r.body.requestId,
          },
        },
      });
      const sources = row.sources as unknown as { content: string }[];
      sources[0]!.content = "tampered evidence";
      await owner.ragTurn.update({
        where: {
          installationId_requestId: {
            installationId: "primary",
            requestId: r.body.requestId,
          },
        },
        data: { sources },
      });
      const read = await call(
        "get",
        `/rag/questions/${r.body.requestId}`,
      ).expect(503);
      expect(read.body).toEqual({ code: "stored_result_unavailable" });
    });
    test("selected source preferences restrict candidates even when other indexed files exist", async () => {
      await owner.basicAgent.update({
        where: { installationId: "primary" },
        data: { sourceOriginalIds: [] },
      });
      const r = await ask().expect(200);
      expect(r.body).toMatchObject({
        status: "refused",
        isAnswerable: false,
        sources: [],
      });
      expect(
        provider.call.mock.calls.some(([, r]) => r.model === "gpt-6-luna"),
      ).toBe(false);
    });
    test("legacy ingestion, Gap/draft and MCP HTTP surfaces remain unavailable in self_hosted", async () => {
      for (const url of ["/ingestion", "/knowledge-gaps", "/drafts", "/mcp"])
        await call("get", url).expect(404);
      expect(await owner.question.count()).toBe(0);
      expect(await owner.knowledgeGap.count()).toBe(0);
      expect(await owner.actionDraft.count()).toBe(0);
    });
  },
);
