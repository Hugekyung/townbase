import { ModelExecutionService } from "../src/model-integration/model-execution.service";
import { OpenAIProvider } from "../src/model-integration/openai-provider";
import {
  PRICE_VERSION,
  DEFAULT_EXECUTION,
} from "../src/model-integration/model-policy";
import { randomUUID } from "node:crypto";
import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { PrismaClient } from "@townbase/database";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { DeploymentModule } from "../src/deployment/deployment.module";
import { DeploymentDatabase } from "../src/deployment/deployment-database";
import { configureSelfHostedHttp } from "../src/deployment/self-hosted-http";
import { AuthService } from "../src/auth/auth.service";
import { hashPassword } from "../src/setup/password";
import {
  CredentialVault,
  type CredentialPurpose,
} from "../src/model-integration/credential-vault";

const integration =
  process.env.TOWNBASE_MODEL_EXECUTION_TEST === "1" ? describe : describe.skip;
integration("model execution with isolated DB and synthetic provider", () => {
  const original = { ...process.env },
    password = "C02 synthetic safe password!";
  const key = "sk-proj-C02-secret-canary-1234567890",
    base = "/settings/model-integration";
  let owner: PrismaClient,
    runtime: DeploymentDatabase,
    app: NestExpressApplication;
  let directory: string, cookie: string, workspaceId: string;
  const provider = { call: jest.fn() };
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (url.hostname !== "postgres" || url.pathname !== "/townbase_c01_test")
      throw new Error("Dedicated C01 test DB required");
    owner = new PrismaClient({
      datasources: { db: { url: url.toString() } },
    });
    url.username = "townbase_runtime";
    url.password = (
      await readFile(process.env.TOWNBASE_RUNTIME_PASSWORD_FILE!, "utf8")
    ).trim();
    process.env.DATABASE_URL = url.toString();
    runtime = new DeploymentDatabase();
  });
  beforeEach(async () => {
    await owner.$executeRaw`ALTER TABLE "InstallationAuditEvent" DROP CONSTRAINT IF EXISTS "C02_reject_audit"`;
    await owner.modelCall.deleteMany();
    await owner.modelExecutionSettings.deleteMany();
    await owner.modelCredential.deleteMany();
    await owner.modelTransferPolicy.deleteMany();
    await owner.administratorSession.deleteMany();
    await owner.installationAuditEvent.deleteMany();
    await owner.administrator.deleteMany();
    await owner.installation.deleteMany();
    await owner.authenticationState.update({
      where: { id: "primary" },
      data: {
        loginFailures: 0,
        loginWindowStart: null,
        loginBlockedUntil: null,
      },
    });
    const workspace = await owner.workspace.upsert({
      where: { name: "c02-test" },
      create: { name: "c02-test" },
      update: {},
    });
    workspaceId = workspace.id;
    await owner.installation.create({
      data: {
        workspaceId,
        initializedAt: new Date(),
        name: "C02 fixture",
        timeZone: "UTC",
      },
    });
    await owner.administrator.create({
      data: {
        installationId: "primary",
        username: "admin",
        passwordHash: await hashPassword(password),
      },
    });
    directory = await mkdtemp(path.join(os.tmpdir(), "townbase-c02-"));
    for (const name of ["BOOTSTRAP", "RECOVERY", "DOCUMENTS", "ATTACHMENTS"]) {
      process.env[`TOWNBASE_${name}_PATH`] = path.join(directory, name);
      await mkdir(process.env[`TOWNBASE_${name}_PATH`]!);
    }
    process.env.TOWNBASE_MASTER_KEY_FILE = path.join(directory, "master");
    await writeFile(
      process.env.TOWNBASE_MASTER_KEY_FILE,
      randomBytes(32).toString("base64url"),
      { mode: 0o444 },
    );
    process.env.TOWNBASE_SETUP_LOCAL_HTTP = "1";
    delete process.env.TOWNBASE_PUBLIC_ORIGIN;
    provider.call.mockReset();
    provider.call.mockImplementation(
      async (_key: string, req: { model: string }) => ({
        usage: {
          input: 10,
          cached: 0,
          write30: 0,
          write12: 0,
          output: req.model === "text-embedding-3-small" ? 0 : 2,
          reasoning: 0,
        },
        providerId:
          req.model === "text-embedding-3-small" ? null : "resp_synthetic",
        outcome: "succeeded",
        ...(req.model === "text-embedding-3-small"
          ? { embedding: Array(1536).fill(0.1) }
          : { text: "OK" }),
      }),
    );
    jest.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw Error("Unexpected external HTTP in synthetic suite");
    });
    const module = await Test.createTestingModule({
      imports: [DeploymentModule],
    })
      .overrideProvider(OpenAIProvider)
      .useValue(provider)
      .overrideProvider(DeploymentDatabase)
      .useValue(runtime)
      .compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    configureSelfHostedHttp(app);
    await app.init();
    const login = await call("post", "/auth/login")
      .send({ username: "admin", password })
      .expect(200);
    cookie = (login.headers["set-cookie"] as unknown as string[])[0]!.split(
      ";",
    )[0]!;
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await app?.close();
    if (directory != null)
      await rm(directory, { recursive: true, force: true });
  });
  afterAll(async () => {
    await owner.$executeRaw`ALTER TABLE "InstallationAuditEvent" DROP CONSTRAINT IF EXISTS "C02_reject_audit"`;
    await runtime.prisma.$disconnect();
    await owner.$disconnect();
    process.env = original;
  });
  function call(
    method: "get" | "put" | "post" | "delete",
    url: string,
    authenticated = false,
  ) {
    const req = request(app.getHttpServer())
      [method](url)
      .set("Host", "localhost:3000")
      .set("Origin", "http://localhost:3000")
      .set("X-Townbase-Auth", "1");
    return authenticated ? req.set("Cookie", cookie) : req;
  }
  function putKey(purpose: CredentialPurpose, apiKey = key) {
    return call("put", base + `/credentials/${purpose}`, true).send({
      currentPassword: password,
      apiKey,
    });
  }
  async function requester() {
    const result = await app
      .get(AuthService)
      .requester(cookie.slice(cookie.indexOf("=") + 1));
    if (!result.ok) throw new Error("Fixture requester unavailable");
    return result.requester;
  }

  const token = () => cookie.slice(cookie.indexOf("=") + 1);
  const config = (extra: Record<string, unknown> = {}) => ({
    ...DEFAULT_EXECUTION,
    monthlyBudgetUsd: "20",
    priceVersion: PRICE_VERSION,
    currentPassword: password,
    ...extra,
  });
  async function configure(extra: Record<string, unknown> = {}) {
    return call("put", base + "/execution", true).send(config(extra));
  }
  async function ready(extra: Record<string, unknown> = {}) {
    await configure(extra).then((r) => expect(r.status).toBe(200));
    await putKey("answer").expect(200);
    await putKey("embedding").expect(200);
    await call("put", base + "/transfers", true)
      .send({
        currentPassword: password,
        documentEmbedding: true,
        rag: true,
        attachment: true,
      })
      .expect(200);
  }
  function check(
    purpose = "answer",
    id: string = randomUUID(),
    currentPassword = password,
  ) {
    return call("post", base + `/checks/${purpose}`, true).send({
      currentPassword,
      requestId: id,
    });
  }
  async function execute(
    input = "Safe synthetic input",
    purpose:
      | "rag_answer"
      | "attachment_answer"
      | "document_embedding"
      | "rag_question_embedding" = "rag_answer",
    requestId = randomUUID(),
  ) {
    return app
      .get(ModelExecutionService)
      .execute(token(), await requester(), { requestId, purpose, input });
  }
  it("starts blocked, rejects missing budget independently of transfer/Key", async () => {
    const r = await call("get", base + "/execution", true).expect(200);
    expect(r.body.blocked).toBe(true);
    await ready({ monthlyBudgetUsd: null });
    await check().expect(409).expect({ code: "budget_not_configured" });
    expect(provider.call).not.toHaveBeenCalled();
  });
  it("rejects an unconfirmed or stale price without dispatch", async () => {
    await ready({ priceVersion: null });
    await check().expect(409).expect({ code: "price_not_confirmed" });
    await owner.modelExecutionSettings.update({
      where: { installationId: "primary" },
      data: { priceVersion: "stale" },
    });
    await check().expect(409);
    expect(provider.call).not.toHaveBeenCalled();
  });
  it.each(["gpt-6-luna", "gpt-6.1-sol"])(
    "stores/reloads %s, reauthenticates and records only real setting changes",
    async (answerModel) => {
      await configure({ answerModel }).then((r) => expect(r.status).toBe(200));
      const count = await owner.installationAuditEvent.count({
        where: { action: "model_execution_settings_changed" },
      });
      await configure({ answerModel }).then((r) => expect(r.status).toBe(200));
      expect(
        await owner.installationAuditEvent.count({
          where: { action: "model_execution_settings_changed" },
        }),
      ).toBe(count);
      const r = await call("get", base + "/execution", true).expect(200);
      expect(r.body.settings.answerModel).toBe(answerModel);
      expect(r.body.settings.monthlyBudgetUsd).toBe("20.00");
      await call("put", base + "/execution", true)
        .send(config({ currentPassword: "incorrect password value" }))
        .expect(401);
    },
  );
  it.each(["answer", "embedding"])(
    "executes %s checks once, persists usage and invalidates verification on Key rotation",
    async (purpose) => {
      await ready();
      const id = randomUUID();
      const r = await check(purpose, id).expect(200);
      expect(r.body.call.status).toBe("succeeded");
      expect(r.body.call.usage.input).toBe(10);
      expect(r.body.call.chargedUsd).not.toBeNull();
      await check(purpose, id).expect(200);
      expect(provider.call).toHaveBeenCalledTimes(1);
      expect(
        (await call("get", base, true).expect(200)).body.credentials[purpose]
          .connection,
      ).toBe("verified");
      const freshService = new ModelExecutionService(
        runtime,
        app.get(AuthService),
        app.get(CredentialVault),
        provider as unknown as OpenAIProvider,
      );
      expect((await freshService.status(await requester(), id)).status).toBe(
        "succeeded",
      );
      await putKey(purpose as CredentialPurpose, key + "rotated").expect(200);
      expect(
        (await call("get", base, true).expect(200)).body.credentials[purpose]
          .connection,
      ).toBe("not_checked");
      expect(
        JSON.stringify(await owner.modelCall.findFirst(), (_key, value) =>
          typeof value === "bigint" ? value.toString() : value,
        ),
      ).not.toContain(key);
    },
  );
  it("invalidates old verification when answer model changes", async () => {
    await ready();
    await check().expect(200);
    await configure({ answerModel: "gpt-6.1-sol" }).then((r) =>
      expect(r.status).toBe(200),
    );
    expect(
      (await call("get", base, true).expect(200)).body.credentials.answer
        .connection,
    ).toBe("not_checked");
  });
  it.each([
    "document_embedding",
    "rag_question_embedding",
    "rag_answer",
    "attachment_answer",
  ] as const)("checks the actual %s dispatch boundary", async (purpose) => {
    await ready();
    await call("put", base + "/transfers", true)
      .send({
        currentPassword: password,
        documentEmbedding: false,
        rag: false,
        attachment: false,
      })
      .expect(200);
    await expect(execute("Synthetic", purpose)).rejects.toThrow(
      "transfer_not_allowed",
    );
    expect(provider.call).not.toHaveBeenCalled();
  });
  it("denies secrets, oversize input, disabled Key and revoked sessions before dispatch", async () => {
    await ready();
    await expect(execute("API_KEY=synthetic-secret")).rejects.toThrow(
      "sensitive_content",
    );
    await expect(execute("x".repeat(16000))).rejects.toThrow(
      "input_limit_exceeded",
    );
    await call("post", base + "/credentials/answer/disable", true)
      .send({ currentPassword: password })
      .expect(200);
    await check().expect(409).expect({ code: "credential_not_enabled" });
    await call("post", "/auth/logout", true).send({}).expect(200);
    await check().expect(401);
    expect(provider.call).not.toHaveBeenCalled();
  });
  it("checks passwords, Content-Type, access scope and strict DTOs", async () => {
    await ready();
    await check("answer", randomUUID(), "wrong password value").expect(401);
    await call("post", base + "/checks/answer", true)
      .send({ requestId: randomUUID(), currentPassword: password, extra: true })
      .expect(400);
    await call("put", base + "/execution", true)
      .send(config({ answerModel: "other" }))
      .expect(400);
    await call("put", base + "/execution", true)
      .send(config({ monthlyBudgetUsd: "NaN" }))
      .expect(400);
    await call("put", base + "/execution", true)
      .send(config({ reasoning: "none", answerModel: "gpt-6.1-sol" }))
      .expect(400);
    await call("get", base + "/execution").expect(401);
    await call("get", base + "/execution", true)
      .set("x-workspace-id", "other")
      .expect(403);
    await call("post", base + "/checks/answer", true)
      .set("Content-Type", "text/plain")
      .send("test")
      .expect(415);
    expect(provider.call).not.toHaveBeenCalled();
  });
  it("serializes simultaneous duplicate checks into one paid dispatch", async () => {
    await ready();
    const id = randomUUID();
    const result = await Promise.all([
      check("answer", id),
      check("answer", id),
    ]);
    expect(result.every((r) => r.status === 200)).toBe(true);
    expect(provider.call).toHaveBeenCalledTimes(1);
    const row = await owner.modelCall.findUniqueOrThrow({
      where: {
        installationId_requestId: { installationId: "primary", requestId: id },
      },
    });
    expect(row.status).toBe("succeeded");
  });
  it("rejects reused ID with changed content and foreign owner reads", async () => {
    await ready();
    const id = randomUUID();
    await execute("first", "rag_answer", id);
    await expect(execute("second", "rag_answer", id)).rejects.toThrow(
      "request_id_conflict",
    );
    await expect(
      app
        .get(ModelExecutionService)
        .status({ ...(await requester()), administratorId: "other" }, id),
    ).rejects.toThrow("call_not_found");
    expect(provider.call).toHaveBeenCalledTimes(1);
  });
  it("holds budget atomically across embedding and answer requests", async () => {
    await ready({ monthlyBudgetUsd: "0.01" });
    // 4,096 output tokens reserve ~0.0021; force held exposure close to limit.
    const first = await execute("small", "document_embedding");
    await owner.modelCall.update({
      where: {
        installationId_requestId: {
          installationId: "primary",
          requestId: first.call.requestId,
        },
      },
      data: { chargedNanoUsd: 9000000n },
    });
    await check().expect(429).expect({ code: "budget_exceeded" });
    expect(
      (await call("get", base + "/execution", true).expect(200)).body.warning80,
    ).toBe(true);
    expect(provider.call).toHaveBeenCalledTimes(1);
  });
  it("atomically reserves competing embedding costs before either response settles", async () => {
    await ready({ monthlyBudgetUsd: "0.01" });
    const anchor = await execute("anchor", "document_embedding");
    await owner.modelCall.update({
      where: {
        installationId_requestId: {
          installationId: "primary",
          requestId: anchor.call.requestId,
        },
      },
      data: { chargedNanoUsd: 9800000n },
    });
    let finish: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const normal = provider.call.getMockImplementation()!;
    provider.call.mockImplementationOnce(async (...args: unknown[]) => {
      await pending;
      return normal(...args);
    });
    const first = execute("first", "document_embedding");
    while (provider.call.mock.calls.length < 2)
      await new Promise((resolve) => setTimeout(resolve, 5));
    try {
      await expect(execute("second", "document_embedding")).rejects.toThrow(
        "budget_exceeded",
      );
    } finally {
      finish();
    }
    expect((await first).call.status).toBe("succeeded");
    expect(provider.call).toHaveBeenCalledTimes(2);
  });
  it("retains ambiguous costs across restart/month boundary and does not retry", async () => {
    await ready();
    provider.call.mockRejectedValueOnce(
      new DOMException("synthetic", "TimeoutError"),
    );
    const id = randomUUID();
    const r = await check("answer", id).expect(200);
    expect(r.body.call).toMatchObject({
      status: "unknown",
      chargedUsd: null,
      errorCode: "provider_timeout",
    });
    await owner.modelCall.update({
      where: {
        installationId_requestId: { installationId: "primary", requestId: id },
      },
      data: { createdAt: new Date("2025-01-01") },
    });
    const fresh = new ModelExecutionService(
      runtime,
      app.get(AuthService),
      app.get(CredentialVault),
      provider as unknown as OpenAIProvider,
    );
    expect((await fresh.snapshot(await requester())).heldUsd).not.toBe(
      "0.000000000",
    );
    await check("answer", id).expect(200);
    expect(provider.call).toHaveBeenCalledTimes(1);
  });
  it("charges incomplete reasoning output instead of claiming success or free usage", async () => {
    await ready();
    provider.call.mockResolvedValueOnce({
      outcome: "incomplete",
      providerId: "resp_incomplete",
      text: "",
      usage: {
        input: 10,
        cached: 0,
        write30: 0,
        write12: 0,
        output: 128,
        reasoning: 128,
      },
    });
    const r = await check().expect(200);
    expect(r.body.call.status).toBe("incomplete");
    expect(r.body.call.chargedUsd).toBe("0.000065000");
  });
  it("preserves reservation on settlement DB failure, readback and repeat never redispatch", async () => {
    await ready();
    await owner.$executeRaw`ALTER TABLE "ModelCall" ADD CONSTRAINT "C01_reject_settlement" CHECK (status <> 'succeeded')`;
    const id = randomUUID();
    try {
      await check("answer", id).expect(503);
    } finally {
      await owner.$executeRaw`ALTER TABLE "ModelCall" DROP CONSTRAINT "C01_reject_settlement"`;
    }
    const r = await check("answer", id).expect(200);
    expect(r.body.call.status).toBe("dispatching");
    expect(provider.call).toHaveBeenCalledTimes(1);
    expect(
      (await app.get(ModelExecutionService).snapshot(await requester()))
        .heldUsd,
    ).not.toBe("0.000000000");
  });
  it("reclaims stale answer concurrency without dropping its unknown charge", async () => {
    await ready();
    await owner.$executeRaw`ALTER TABLE "ModelCall" ADD CONSTRAINT "C01_reject_settlement" CHECK (status <> 'succeeded')`;
    const id = randomUUID();
    try {
      await check("answer", id).expect(503);
    } finally {
      await owner.$executeRaw`ALTER TABLE "ModelCall" DROP CONSTRAINT "C01_reject_settlement"`;
    }
    await owner.modelCall.update({
      where: {
        installationId_requestId: { installationId: "primary", requestId: id },
      },
      data: {
        createdAt: new Date(Date.now() - 120000),
        deadlineAt: new Date(Date.now() - 30000),
      },
    });
    await check().expect(200);
    expect(
      (await app.get(ModelExecutionService).status(await requester(), id))
        .status,
    ).toBe("unknown");
  });
  it("limits answer concurrency while the first actual provider call is pending", async () => {
    await ready();
    let finish: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const normal = provider.call.getMockImplementation()!;
    provider.call.mockImplementationOnce(async (...args: unknown[]) => {
      await pending;
      return normal(...args);
    });
    const first = check().then((r) => r);
    while (provider.call.mock.calls.length === 0)
      await new Promise((resolve) => setTimeout(resolve, 5));
    await check().expect(429).expect({ code: "answer_busy" });
    finish();
    expect((await first).status).toBe(200);
  });
  it("limits ten fresh answer attempts per rolling minute", async () => {
    await ready();
    for (let i = 0; i < 10; i++) await check().expect(200);
    await check().expect(429).expect({ code: "call_rate_limited" });
    expect(provider.call).toHaveBeenCalledTimes(10);
  });
  it("rolls back an internal reservation if the session expires during preflight", async () => {
    await ready();
    const context = await requester();
    await owner.administratorSession.updateMany({
      data: { expiresAt: new Date(Date.now() + 300) },
    });
    const vault = app.get(CredentialVault);
    const prepare = vault.prepareReader.bind(vault);
    jest.spyOn(vault, "prepareReader").mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      return prepare();
    });
    await expect(
      app.get(ModelExecutionService).execute(token(), context, {
        requestId: randomUUID(),
        purpose: "rag_answer",
        input: "Synthetic",
      }),
    ).rejects.toThrow("unauthorized");
    expect(provider.call).not.toHaveBeenCalled();
    expect(await owner.modelCall.count()).toBe(0);
  });
  it("denies forged internal scope and damaged master before actual dispatch", async () => {
    await ready();
    const context = await requester();
    const service = app.get(ModelExecutionService);
    await expect(
      service.execute(
        token(),
        { ...context, workspaceId: "foreign" },
        { requestId: randomUUID(), purpose: "rag_answer", input: "Synthetic" },
      ),
    ).rejects.toThrow("unauthorized");
    await rm(process.env.TOWNBASE_MASTER_KEY_FILE!);
    await writeFile(process.env.TOWNBASE_MASTER_KEY_FILE!, "broken", {
      mode: 0o444,
    });
    await expect(execute()).rejects.toThrow("master_key_unavailable");
    expect(provider.call).not.toHaveBeenCalled();
    expect(await owner.modelCall.count()).toBe(0);
  });
  it("releases only a known not-sent reservation if dispatch admission expires", async () => {
    await ready();
    jest.spyOn(Date, "now").mockReturnValue(Date.now() + 120000);
    const id = randomUUID();
    const r = await check("answer", id).expect(200);
    expect(r.body.call).toMatchObject({
      status: "not_sent",
      chargedUsd: "0.000000000",
      errorCode: "dispatch_deadline_exceeded",
    });
    await check("answer", id).expect(200);
    expect(provider.call).not.toHaveBeenCalled();
    expect(
      (await app.get(ModelExecutionService).snapshot(await requester()))
        .heldUsd,
    ).toBe("0.000000000");
  });
  it.each([
    ["answer", 16001, 2],
    ["answer", 10, 4097],
    ["embedding", 8193, 0],
    ["embedding", 10, 1],
  ] as const)(
    "retains an ambiguous %s reservation for usage input=%i output=%i",
    async (purpose, input, output) => {
      await ready();
      provider.call.mockResolvedValueOnce({
        outcome: "succeeded",
        providerId: "resp_synthetic",
        text: "must not return this",
        usage: {
          input,
          cached: 0,
          write30: 0,
          write12: 0,
          output,
          reasoning: 0,
        },
      });
      const id = randomUUID();
      const service = app.get(ModelExecutionService);
      const response = await service.check(
        token(),
        password,
        await requester(),
        id,
        purpose,
      );
      expect(response.result).toBeUndefined();
      expect(response.call).toMatchObject({
        status: "unknown",
        errorCode: "usage_out_of_bounds",
        chargedUsd: null,
        usage: null,
      });
      const row = await owner.modelCall.findUniqueOrThrow({
        where: {
          installationId_requestId: {
            installationId: "primary",
            requestId: id,
          },
        },
      });
      expect(row.chargedNanoUsd).toBeNull();
      expect(row.reservedNanoUsd).toBeGreaterThan(0n);
      const held = (await service.snapshot(await requester())).heldUsd;
      await check(purpose, id).expect(200);
      expect(provider.call).toHaveBeenCalledTimes(1);
      expect((await service.snapshot(await requester())).heldUsd).toBe(held);
    },
  );
  it("accepts uppercase UUID creation, lowercase retry and either-case lookup as one call", async () => {
    await ready();
    const id = "ABCDEFAB-ABCD-4ABC-ABCD-ABCDEFABCDEF";
    const r = await check("answer", id).expect(200);
    expect(r.body.call.requestId).toBe(id.toLowerCase());
    await check("answer", id.toLowerCase()).expect(200);
    for (const requestId of [id, id.toLowerCase()])
      await call("get", base + "/calls/" + requestId, true).expect(200);
    expect(provider.call).toHaveBeenCalledTimes(1);
    expect(await owner.modelCall.count()).toBe(1);
  });
  it("preserves the public budget read-modify-write format and no-op audit", async () => {
    await ready();
    const r = await call("get", base + "/execution", true).expect(200);
    expect(r.body.settings.monthlyBudgetUsd).toBe("20.00");
    const before = await owner.installationAuditEvent.count({
      where: { action: "model_execution_settings_changed" },
    });
    await call("put", base + "/execution", true)
      .send({ ...r.body.settings, currentPassword: password })
      .expect(200);
    expect(
      await owner.installationAuditEvent.count({
        where: { action: "model_execution_settings_changed" },
      }),
    ).toBe(before);
    await call("put", base + "/execution", true)
      .send({
        ...r.body.settings,
        currentPassword: password,
        outputTokenLimit: 128,
      })
      .expect(200);
    expect(
      (await call("get", base + "/execution", true).expect(200)).body.settings
        .outputTokenLimit,
    ).toBe(128);
  });
  it.each(["purpose", "fileNames"])(
    "conflicts on changed %s even with the same ID and text",
    async (field) => {
      await ready();
      const service = app.get(ModelExecutionService),
        context = await requester(),
        id = randomUUID();
      const input = {
        requestId: id,
        purpose: "rag_answer" as const,
        input: "same synthetic text",
        fileNames: ["one.txt"],
      };
      await service.execute(token(), context, input);
      const changed =
        field === "purpose"
          ? { ...input, purpose: "attachment_answer" as const }
          : { ...input, fileNames: ["two.txt"] };
      await expect(service.execute(token(), context, changed)).rejects.toThrow(
        "request_id_conflict",
      );
      expect(provider.call).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["execute", "check"])(
    "allows logout while %s waits for the secret volume",
    async (mode) => {
      await ready();
      const service = app.get(ModelExecutionService),
        context = await requester(),
        vault = app.get(CredentialVault),
        prepare = vault.prepareReader.bind(vault);
      let signal: () => void = () => {},
        release: () => void = () => {};
      const started = new Promise<void>((resolve) => {
          signal = resolve;
        }),
        gate = new Promise<void>((resolve) => {
          release = resolve;
        });
      let disposed = false;
      jest.spyOn(vault, "prepareReader").mockImplementationOnce(async () => {
        signal();
        await gate;
        const reader = await prepare();
        return {
          ...reader,
          dispose: () => {
            disposed = true;
            reader.dispose();
          },
        };
      });
      const operation =
        mode === "execute"
          ? service.execute(token(), context, {
              requestId: randomUUID(),
              purpose: "rag_answer",
              input: "Synthetic",
            })
          : service.check(token(), password, context, randomUUID(), "answer");
      const outcome = operation.then(
        () => ({ code: "unexpected_success" }),
        (error) => ({ code: error.code as string }),
      );
      await started;
      try {
        await call("post", "/auth/logout", true)
          .send({})
          .timeout({ response: 5000, deadline: 6000 })
          .expect(200);
      } finally {
        release();
      }
      expect(await outcome).toEqual({ code: "unauthorized" });
      expect(disposed).toBe(true);
      expect(provider.call).not.toHaveBeenCalled();
      expect(await owner.modelCall.count()).toBe(0);
    },
    15000,
  );
  it("uses a Key rotated during secret preloading, never the earlier credential row", async () => {
    await ready();
    const vault = app.get(CredentialVault),
      prepare = vault.prepareReader.bind(vault);
    const rotated = key + "rotated";
    jest.spyOn(vault, "prepareReader").mockImplementationOnce(async () => {
      const reader = await prepare();
      await putKey("answer", rotated).timeout({ response: 5000 }).expect(200);
      return reader;
    });
    await execute();
    expect(provider.call.mock.calls[0]![0]).toBe(rotated);
  });
  it("checks the latest policy after preloading and disposes on rejection", async () => {
    await ready();
    const vault = app.get(CredentialVault),
      prepare = vault.prepareReader.bind(vault);
    let reader:
      | Awaited<ReturnType<CredentialVault["prepareReader"]>>
      | undefined;
    jest.spyOn(vault, "prepareReader").mockImplementationOnce(async () => {
      reader = await prepare();
      await call("put", base + "/transfers", true)
        .send({
          currentPassword: password,
          documentEmbedding: false,
          rag: false,
          attachment: false,
        })
        .timeout({ response: 5000 })
        .expect(200);
      return reader;
    });
    await expect(execute()).rejects.toThrow("transfer_not_allowed");
    const row = await owner.modelCredential.findUniqueOrThrow({
      where: {
        installationId_purpose: {
          installationId: "primary",
          purpose: "answer",
        },
      },
    });
    expect(() => reader!.reveal("primary", "answer", row)).toThrow(
      "credential_unavailable",
    );
    expect(provider.call).not.toHaveBeenCalled();
    expect(await owner.modelCall.count()).toBe(0);
  });
  it("rejects unconfigured budget or denied transfers before touching secret storage", async () => {
    await ready({ monthlyBudgetUsd: null });
    await rm(process.env.TOWNBASE_MASTER_KEY_FILE!);
    const spy = jest.spyOn(app.get(CredentialVault), "prepareReader");
    await check().expect(409).expect({ code: "budget_not_configured" });
    await configure().then((r) => expect(r.status).toBe(200));
    await call("put", base + "/transfers", true)
      .send({
        currentPassword: password,
        documentEmbedding: false,
        rag: false,
        attachment: false,
      })
      .expect(200);
    await check().expect(403).expect({ code: "transfer_not_allowed" });
    expect(spy).not.toHaveBeenCalled();
    expect(provider.call).not.toHaveBeenCalled();
  });
  it("returns a duplicate status without loading a missing master", async () => {
    await ready();
    const id = randomUUID();
    await check("answer", id).expect(200);
    await rm(process.env.TOWNBASE_MASTER_KEY_FILE!);
    const spy = jest.spyOn(app.get(CredentialVault), "prepareReader");
    await check("answer", id).expect(200);
    expect(spy).not.toHaveBeenCalled();
    expect(provider.call).toHaveBeenCalledTimes(1);
  });
  it("rolls back settings when audit persistence fails", async () => {
    await ready();
    await owner.$executeRaw`ALTER TABLE "InstallationAuditEvent" ADD CONSTRAINT "C01_reject_audit" CHECK (action <> 'model_execution_settings_changed') NOT VALID`;
    try {
      await configure({ answerModel: "gpt-6.1-sol" }).then((r) =>
        expect(r.status).toBe(503),
      );
    } finally {
      await owner.$executeRaw`ALTER TABLE "InstallationAuditEvent" DROP CONSTRAINT "C01_reject_audit"`;
    }
    expect(
      (
        await owner.modelExecutionSettings.findUniqueOrThrow({
          where: { installationId: "primary" },
        })
      ).answerModel,
    ).toBe("gpt-6-luna");
  });
});
