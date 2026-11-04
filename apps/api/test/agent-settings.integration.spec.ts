import "reflect-metadata";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { readFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@townbase/database";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import type { AdministratorContext } from "../src/auth/auth.service";
import { assertFreshFileManagementDatabase } from "./file-management-fixture";
const built = createRequire(__filename);
const { DeploymentModule } = built(
  "../dist/deployment/deployment.module",
) as typeof import("../src/deployment/deployment.module");
const { configureSelfHostedHttp } = built(
  "../dist/deployment/self-hosted-http",
) as typeof import("../src/deployment/self-hosted-http");
const { AgentService } = built(
  "../dist/agent/agent.service",
) as typeof import("../src/agent/agent.service");
const { AuthService } = built(
  "../dist/auth/auth.service",
) as typeof import("../src/auth/auth.service");
const { OpenAIProvider } = built(
  "../dist/model-integration/openai-provider",
) as typeof import("../src/model-integration/openai-provider");
const { hashPassword } = built(
  "../dist/setup/password",
) as typeof import("../src/setup/password");
const enabled =
  process.env.TOWNBASE_AGENT_SETTINGS_TEST === "1" ? describe : describe.skip;
enabled("E01 persisted Agent settings, actual HTTP/auth/runtime role", () => {
  jest.setTimeout(60000);
  const environment = { ...process.env },
    password = "E01 synthetic fixture password!",
    base = "/settings/agent";
  const provider = {
    call: jest.fn(() => {
      throw new Error("E01 must not call provider");
    }),
  };
  let owner: PrismaClient,
    app: NestExpressApplication,
    directory: string,
    cookie: string,
    token: string,
    context: AdministratorContext;
  let first: string, second: string;
  const config = () => ({
    name: "문서 도우미",
    purpose: "출처 기반 회사 문서 안내",
    instructions: "짧게 답변",
    terminology: [{ term: "출고", meaning: "창고 발송" }],
    sourceSelection: "selected",
    sourceOriginalIds: [first],
  });
  const headers = () => ({
    Host: "127.0.0.1:3000",
    Origin: "http://127.0.0.1:3000",
    "X-Townbase-Auth": "1",
    Cookie: cookie,
  });
  const call = (method: "get" | "put" | "post", url = base) =>
    request(app.getHttpServer())[method](url).set(headers());
  const save = (expectedRevision = 0, settings = config()) =>
    call("put").send({
      ...settings,
      currentPassword: password,
      expectedRevision,
    });
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
    const response = await call("post", "/auth/login")
      .send({ username: "e01-admin", password })
      .expect(200);
    cookie = (response.headers["set-cookie"] as unknown as string[])[0]!.split(
      ";",
    )[0]!;
    token = cookie.slice(cookie.indexOf("=") + 1);
    const result = await app.get(AuthService).requester(token);
    if (!result.ok) throw new Error("Fixture login unavailable");
    context = result.requester;
  }
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (url.hostname !== "postgres" || url.pathname !== "/townbase_e01_test")
      throw new Error("Dedicated fresh E01 test DB required");
    owner = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    await assertFreshFileManagementDatabase(owner);
    if (await owner.basicAgent.count())
      throw new Error("E01 fixture already exists");
    const workspace = await owner.workspace.create({
      data: { name: "E01 synthetic" },
    });
    await owner.installation.create({
      data: {
        workspaceId: workspace.id,
        name: "E01 synthetic",
        timeZone: "UTC",
        initializedAt: new Date(),
      },
    });
    const admin = await owner.administrator.create({
      data: {
        installationId: "primary",
        username: "e01-admin",
        passwordHash: await hashPassword(password),
      },
    });
    first = randomUUID();
    second = randomUUID();
    for (const id of [first, second])
      await owner.fileOriginal.create({
        data: {
          id,
          installationId: "primary",
          ownerAdministratorId: admin.id,
          title: "E01 synthetic source",
        },
      });
    url.username = "townbase_runtime";
    url.password = (
      await readFile(process.env.TOWNBASE_RUNTIME_PASSWORD_FILE!, "utf8")
    ).trim();
    process.env.DATABASE_URL = url.toString();
    directory = await mkdtemp(path.join(tmpdir(), "townbase-e01-"));
    for (const name of ["BOOTSTRAP", "RECOVERY", "DOCUMENTS", "ATTACHMENTS"]) {
      process.env[`TOWNBASE_${name}_PATH`] = path.join(directory, name);
      await mkdir(process.env[`TOWNBASE_${name}_PATH`]!);
    }
    process.env.TOWNBASE_SETUP_LOCAL_HTTP = "1";
    process.env.TOWNBASE_RUNTIME_PROFILE = "self_hosted";
    delete process.env.TOWNBASE_PUBLIC_ORIGIN;
    cookie = "";
    await start();
    await login();
  });
  beforeEach(async () => {
    await owner.basicAgent.deleteMany();
    await owner.modelExecutionSettings.deleteMany();
    await owner.installationAuditEvent.deleteMany();
    await owner.fileOriginal.updateMany({
      data: { excludedAt: null, deletedAt: null },
    });
    provider.call.mockClear();
  });
  afterAll(async () => {
    await app?.close();
    await owner?.$disconnect();
    if (directory) await rm(directory, { recursive: true, force: true });
    process.env = environment;
  });
  test("GET is read only and never auto-creates an Agent or paid call", async () => {
    const response = await call("get")
      .expect(200)
      .expect("Cache-Control", "no-store");
    expect(response.body).toMatchObject({
      agent: null,
      answerModel: "gpt-6-luna",
      modelSettingsPath: "/settings/model-integration/execution",
    });
    expect(await owner.basicAgent.count()).toBe(0);
    expect(await owner.installationAuditEvent.count()).toBe(0);
    expect(await owner.modelCall.count()).toBe(0);
    expect(provider.call).not.toHaveBeenCalled();
  });
  test("stores one Agent with audit and reads it after logout, login and app restart", async () => {
    const saved = await save().expect(200);
    const stored = await owner.basicAgent.findUniqueOrThrow({
      where: { installationId: "primary" },
    });
    expect(stored).toMatchObject({
      ...config(),
      revision: 1,
      ownerAdministratorId: context.administratorId,
    });
    expect(saved.body.agent.id).toBe(stored.id);
    expect(
      await owner.installationAuditEvent.count({
        where: { action: "agent_settings_changed" },
      }),
    ).toBe(1);
    await call("post", "/auth/logout").send({}).expect(200);
    await call("get").expect(401);
    await app.close();
    await start();
    await login();
    expect((await call("get").expect(200)).body.agent).toEqual(
      saved.body.agent,
    );
    expect(await owner.basicAgent.count()).toBe(1);
  });
  test("same state does not change revision, timestamp or change audit", async () => {
    const firstSave = await save().expect(200);
    const secondSave = await save(1).expect(200);
    expect(secondSave.body.agent).toEqual(firstSave.body.agent);
    expect(
      await owner.installationAuditEvent.count({
        where: { action: "agent_settings_changed" },
      }),
    ).toBe(1);
  });
  test("stale and concurrent edits never overwrite a newer saved revision", async () => {
    await save().expect(200);
    const results = await Promise.all([
      save(1, { ...config(), name: "A" }),
      save(1, { ...config(), name: "B" }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.code).toBe(
      "agent_changed",
    );
    expect((await owner.basicAgent.findFirstOrThrow()).revision).toBe(2);
    await save(0).expect(409);
  });
  test("wrong password and missing credentials cannot write settings", async () => {
    await request(app.getHttpServer())
      .put(base)
      .set({ ...headers(), Cookie: "" })
      .send({ ...config(), expectedRevision: 0, currentPassword: password })
      .expect(401);
    await call("put")
      .send({
        ...config(),
        expectedRevision: 0,
        currentPassword: "E01 incorrect password!",
      })
      .expect(401);
    expect(await owner.basicAgent.count()).toBe(0);
  });
  test("session expiry between guard and storage is rechecked", async () => {
    const service = app.get(AgentService),
      original = service.snapshot.bind(service);
    const spy = jest
      .spyOn(service, "snapshot")
      .mockImplementationOnce(async (...args) => {
        await owner.administratorSession.updateMany({
          data: { revokedAt: new Date() },
        });
        return original(...args);
      });
    await call("get").expect(401);
    spy.mockRestore();
    await login();
  });
  test("scope claims, wrong Origin and non-JSON input are rejected", async () => {
    await call("get").set("X-Workspace-Id", "another-workspace").expect(403);
    await call("put")
      .set("Origin", "https://evil.example")
      .send({ ...config(), currentPassword: password, expectedRevision: 0 })
      .expect(403);
    await call("put").type("text").send("{}").expect(415);
    await call("put")
      .set("Content-Type", "application/json")
      .send("{")
      .expect(400);
    await call("put")
      .send({
        ...config(),
        instructions: "x".repeat(9000),
        expectedRevision: 0,
        currentPassword: password,
      })
      .expect(413);
    expect(await owner.basicAgent.count()).toBe(0);
  });
  test.each([
    "answerModel",
    "embeddingModel",
    "workspaceId",
    "ownerAdministratorId",
    "id",
    "revision",
  ])("cannot mutate forbidden %s through Agent settings", async (key) => {
    await call("put")
      .send({
        ...config(),
        currentPassword: password,
        expectedRevision: 0,
        [key]: "injected",
      })
      .expect(key === "workspaceId" ? 403 : 400);
    expect(await owner.basicAgent.count()).toBe(0);
  });
  test("C model selection is reflected immediately, without a second model value or provider call", async () => {
    await save().expect(200);
    await call("put", "/settings/model-integration/execution")
      .send({
        currentPassword: password,
        answerModel: "gpt-6.1-sol",
        reasoning: "low",
        inputTokenLimit: 16000,
        outputTokenLimit: 4096,
        monthlyBudgetUsd: null,
        priceVersion: null,
      })
      .expect(200);
    expect((await call("get").expect(200)).body.answerModel).toBe(
      "gpt-6.1-sol",
    );
    expect((await owner.basicAgent.findFirstOrThrow()).revision).toBe(1);
    expect(provider.call).not.toHaveBeenCalled();
    expect(await owner.modelCall.count()).toBe(0);
  });
  test.each(["missing", "excluded", "deleted"])(
    "%s source cannot be selected",
    async (state) => {
      if (state === "excluded")
        await owner.fileOriginal.update({
          where: { id: first },
          data: { excludedAt: new Date() },
        });
      if (state === "deleted")
        await owner.fileOriginal.update({
          where: { id: first },
          data: { deletedAt: new Date() },
        });
      await save(0, {
        ...config(),
        sourceOriginalIds: [state === "missing" ? randomUUID() : first],
      }).expect(409);
      expect(await owner.basicAgent.count()).toBe(0);
      expect(await owner.installationAuditEvent.count()).toBe(0);
    },
  );
  test("selected/all preference does not grant other, deleted or excluded source access", async () => {
    const saved = (await save().expect(200)).body.agent;
    const service = app.get(AgentService);
    const check = (ids: string[], expected = saved, c = context) =>
      app.get(AuthService).authorizedOperation(token, c, async (tx, fresh) => {
        await service.assertSourceSelection(tx, fresh, expected, ids);
        return {};
      });
    expect((await check([first])).ok).toBe(true);
    await expect(check([second])).rejects.toMatchObject({
      response: { code: "agent_source_unavailable" },
    });
    await expect(
      check([first], { ...saved, revision: 0 }),
    ).rejects.toMatchObject({ response: { code: "agent_changed" } });
    expect(
      (await check([first], saved, { ...context, workspaceId: "foreign" })).ok,
    ).toBe(false);
    const all = (
      await save(1, {
        ...config(),
        sourceSelection: "all",
        sourceOriginalIds: [],
      }).expect(200)
    ).body.agent;
    expect((await check([second], all)).ok).toBe(true);
    await owner.fileOriginal.update({
      where: { id: second },
      data: { excludedAt: new Date() },
    });
    await expect(check([second], all)).rejects.toMatchObject({
      response: { code: "agent_source_unavailable" },
    });
    await owner.fileOriginal.update({
      where: { id: first },
      data: { deletedAt: new Date() },
    });
    await expect(check([first], all)).rejects.toMatchObject({
      response: { code: "agent_source_unavailable" },
    });
    await expect(check([randomUUID()], all)).rejects.toMatchObject({
      response: { code: "agent_source_unavailable" },
    });
  });
  test("audit failure rolls back both creation and updates", async () => {
    await owner.$executeRaw`ALTER TABLE "InstallationAuditEvent" ADD CONSTRAINT "E01_reject_audit" CHECK (action <> 'agent_settings_changed')`;
    try {
      await save().expect(503);
      expect(await owner.basicAgent.count()).toBe(0);
    } finally {
      await owner.$executeRaw`ALTER TABLE "InstallationAuditEvent" DROP CONSTRAINT "E01_reject_audit"`;
    }
    await save().expect(200);
    await owner.$executeRaw`ALTER TABLE "InstallationAuditEvent" ADD CONSTRAINT "E01_reject_audit" CHECK (action <> 'agent_settings_changed') NOT VALID`;
    try {
      await save(1, { ...config(), name: "rollback" }).expect(503);
      expect(await owner.basicAgent.findFirstOrThrow()).toMatchObject({
        revision: 1,
        name: config().name,
      });
    } finally {
      await owner.$executeRaw`ALTER TABLE "InstallationAuditEvent" DROP CONSTRAINT "E01_reject_audit"`;
    }
  });
  test("DB enforces singleton, owner relation and positive revisions", async () => {
    await save().expect(200);
    const row = await owner.basicAgent.findFirstOrThrow();
    await expect(
      owner.basicAgent.create({
        data: { ...row, id: randomUUID(), terminology: [] },
      }),
    ).rejects.toThrow();
    await expect(
      owner.basicAgent.update({
        where: { installationId: "primary" },
        data: { revision: 0 },
      }),
    ).rejects.toThrow();
    await expect(
      owner.basicAgent.update({
        where: { installationId: "primary" },
        data: { ownerAdministratorId: "another-owner" },
      }),
    ).rejects.toThrow();
  });
  test("unknown/corrupt stored configuration fails closed without leaking its content", async () => {
    await save().expect(200);
    await owner.basicAgent.update({
      where: { installationId: "primary" },
      data: { terminology: [{ invalid: "E01 private canary" }] },
    });
    const response = await call("get").expect(503);
    expect(response.body).toEqual({ code: "agent_unavailable" });
    expect(JSON.stringify(response.body)).not.toContain("canary");
    expect(provider.call).not.toHaveBeenCalled();
  });
  test("empty explicit selection persists and source selection rechecks later exclusion", async () => {
    const empty = await save(0, { ...config(), sourceOriginalIds: [] }).expect(
      200,
    );
    expect(empty.body.agent.sourceOriginalIds).toEqual([]);
    const service = app.get(AgentService);
    await expect(
      app
        .get(AuthService)
        .authorizedOperation(token, context, async (tx, fresh) => {
          await service.assertSourceSelection(tx, fresh, empty.body.agent, [
            first,
          ]);
          return {};
        }),
    ).rejects.toMatchObject({ response: { code: "agent_source_unavailable" } });
    const selected = await save(1).expect(200);
    await owner.fileOriginal.update({
      where: { id: first },
      data: { excludedAt: new Date() },
    });
    await expect(
      app
        .get(AuthService)
        .authorizedOperation(token, context, async (tx, fresh) => {
          await service.assertSourceSelection(tx, fresh, selected.body.agent, [
            first,
          ]);
          return {};
        }),
    ).rejects.toMatchObject({ response: { code: "agent_source_unavailable" } });
  });
});
