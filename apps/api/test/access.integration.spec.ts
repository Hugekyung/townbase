import "reflect-metadata";
import { Controller, Get, Inject, Param, Req } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { PrismaClient } from "@townbase/database";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AuthModule } from "../src/auth/auth.module";
import { AuthService, credentialDigest } from "../src/auth/auth.service";
import { hashPassword } from "../src/setup/password";
import { DeploymentDatabase } from "../src/deployment/deployment-database";
import {
  AccessService,
  type AccessRequest,
} from "../src/access/access.service";
import { configureSelfHostedHttp } from "../src/deployment/self-hosted-http";
type Readback = {
  find(id: string): Promise<{ workspaceId: string; title: string } | null>;
};
@Controller("stored-resource-fixture")
class StoredResourceFixture {
  constructor(
    private readonly access: AccessService,
    @Inject("TEST_READBACK") private readonly readback: Readback,
  ) {}
  @Get(":documentId") async document(
    @Req() req: AccessRequest,
    @Param("documentId") id: string,
  ) {
    const row = await this.readback.find(id);
    this.access.assertWorkspaceResource(req, { workspaceId: row?.workspaceId });
    return { title: row!.title };
  }
}
const integration =
  process.env.TOWNBASE_ACCESS_INTEGRATION === "1" ? describe : describe.skip;
integration("stored administrator and workspace access boundary", () => {
  let owner: PrismaClient,
    runtime: DeploymentDatabase,
    app: NestExpressApplication,
    directory: string;
  let ownId: string,
    foreignId: string,
    workspaceId: string,
    administratorId: string;
  const env = { ...process.env },
    password = "B05 synthetic safe password!";
  const find = jest.fn();
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (url.hostname !== "postgres" || url.pathname !== "/townbase_b05_test")
      throw new Error("Dedicated B05 test DB required");
    owner = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    url.username = "townbase_runtime";
    url.password = (
      await readFile(process.env.TOWNBASE_RUNTIME_PASSWORD_FILE!, "utf8")
    ).trim();
    process.env.DATABASE_URL = url.toString();
    runtime = new DeploymentDatabase();
  });
  beforeEach(async () => {
    await owner.administratorSession.deleteMany();
    await owner.installationAuditEvent.deleteMany();
    await owner.administrator.deleteMany();
    await owner.installation.deleteMany();
    await owner.dataSource.deleteMany();
    await owner.authenticationState.update({
      where: { id: "primary" },
      data: {
        loginFailures: 0,
        loginWindowStart: null,
        loginBlockedUntil: null,
        recoveryHash: null,
        recoveryIssuedAt: null,
        recoveryExpiresAt: null,
        recoveryConsumedAt: null,
        recoveryFailures: 0,
        recoveryWindowStart: null,
        recoveryBlockedUntil: null,
      },
    });
    const workspace = await owner.workspace.findUniqueOrThrow({
      where: { name: "townbase" },
    });
    workspaceId = workspace.id;
    const foreign = await owner.workspace.upsert({
      where: { name: "b05-foreign" },
      create: { name: "b05-foreign" },
      update: {},
    });
    await owner.installation.create({
      data: {
        workspaceId,
        initializedAt: new Date(),
        name: "B05 test",
        timeZone: "UTC",
      },
    });
    const admin = await owner.administrator.create({
      data: {
        installationId: "primary",
        username: "admin",
        passwordHash: await hashPassword(password),
      },
    });
    administratorId = admin.id;
    for (const [id, title] of [
      [workspaceId, "own"],
      [foreign.id, "foreign"],
    ] as const) {
      const source = await owner.dataSource.create({
        data: { workspaceId: id, name: "fixture", type: "local_repo" },
      });
      const doc = await owner.document.create({
        data: {
          workspaceId: id,
          dataSourceId: source.id,
          externalId: title,
          sourceType: "repo_docs",
          title,
          content: "synthetic fixture",
          knowledgeTypes: [],
          domainTags: [],
        },
      });
      if (title === "own") ownId = doc.id;
      else foreignId = doc.id;
    }
    directory = await mkdtemp(path.join(os.tmpdir(), "townbase-b05-"));
    for (const kind of ["BOOTSTRAP", "RECOVERY", "DOCUMENTS", "ATTACHMENTS"]) {
      process.env[`TOWNBASE_${kind}_PATH`] = path.join(
        directory,
        kind.toLowerCase(),
      );
      await mkdir(process.env[`TOWNBASE_${kind}_PATH`]!);
    }
    process.env.TOWNBASE_SETUP_LOCAL_HTTP = "1";
    delete process.env.TOWNBASE_PUBLIC_ORIGIN;
    find.mockReset();
    find.mockImplementation((id: string) =>
      owner.document.findUnique({
        where: { id },
        select: { workspaceId: true, title: true },
      }),
    );
    const module = await Test.createTestingModule({
      imports: [AuthModule],
      controllers: [StoredResourceFixture],
      providers: [{ provide: "TEST_READBACK", useValue: { find } }],
    })
      .overrideProvider(DeploymentDatabase)
      .useValue({ prisma: runtime.prisma })
      .compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    configureSelfHostedHttp(app);
    await app.init();
  });
  afterEach(async () => {
    await app?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  afterAll(async () => {
    if (owner) {
      await owner.administratorSession.deleteMany();
      await owner.installationAuditEvent.deleteMany();
      await owner.administrator.deleteMany();
      await owner.installation.deleteMany();
      await owner.dataSource.deleteMany();
      await owner.workspace.deleteMany({ where: { name: "b05-foreign" } });
      await owner.$disconnect();
    }
    await runtime?.onApplicationShutdown();
    process.env = { ...env };
  });
  const login = async () => {
    const response = await request(app.getHttpServer())
      .post("/auth/login")
      .set("Host", "localhost:3000")
      .set("Origin", "http://localhost:3000")
      .set("X-Townbase-Auth", "1")
      .send({ username: "admin", password })
      .expect(200);
    return response.headers["set-cookie"]![0]!.split(";")[0]!;
  };
  const get = (route: string, cookie?: string) => {
    const call = request(app.getHttpServer())
      .get(route)
      .set("Host", "localhost:3000")
      .set("X-Townbase-Auth", "1");
    return cookie ? call.set("Cookie", cookie) : call;
  };
  it("binds stored identity to the installation workspace, independently of deployment defaults", async () => {
    const cookie = await login();
    process.env.TOWNBASE_DEFAULT_WORKSPACE_NAME = "b05-foreign";
    const token = cookie.slice("townbase_session=".length);
    const result = await app.get(AuthService).requester(token);
    expect(result).toMatchObject({
      ok: true,
      requester: { administratorId, installationId: "primary", workspaceId },
    });
    await get(`/stored-resource-fixture/${ownId}`, cookie)
      .expect(200)
      .expect({ title: "own" });
    await get(`/stored-resource-fixture/${foreignId}`, cookie).expect(403);
    await get(`/auth/session?workspaceId=forged`, cookie).expect(403);
  });
  it("refuses caller IDs without a session before reading resources", async () => {
    await get(
      `/stored-resource-fixture/${ownId}?workspaceId=${workspaceId}`,
    ).expect(401);
    expect(find).not.toHaveBeenCalled();
  });
  it("rejects revoked and independently idle-expired sessions before resource reads", async () => {
    const cookie = await login(),
      token = cookie.slice("townbase_session=".length);
    await owner.administratorSession.update({
      where: { tokenHash: credentialDigest(token) },
      data: {
        createdAt: new Date(Date.now() - 3600000),
        lastSeenAt: new Date(Date.now() - 31 * 60000),
      },
    });
    await get(`/stored-resource-fixture/${ownId}`, cookie).expect(401);
    expect(find).not.toHaveBeenCalled();
    const other = await login();
    await owner.administratorSession.updateMany({
      data: { revokedAt: new Date() },
    });
    await get(`/stored-resource-fixture/${ownId}`, other).expect(401);
    expect(find).not.toHaveBeenCalled();
  });
  it("rejects disabled administrators and password-revoked sessions on the guarded HTTP path", async () => {
    const cookie = await login();
    await owner.administrator.updateMany({ data: { disabledAt: new Date() } });
    await get(`/stored-resource-fixture/${ownId}`, cookie).expect(401);
    expect(find).not.toHaveBeenCalled();
    await owner.administrator.updateMany({ data: { disabledAt: null } });
    const fresh = await login();
    await request(app.getHttpServer())
      .post("/auth/password")
      .set("Host", "localhost:3000")
      .set("Origin", "http://localhost:3000")
      .set("X-Townbase-Auth", "1")
      .set("Cookie", fresh)
      .send({
        currentPassword: password,
        newPassword: "B05 changed safe password!",
      })
      .expect(200);
    await get(`/stored-resource-fixture/${ownId}`, cookie).expect(401);
    await get(`/stored-resource-fixture/${ownId}`, fresh).expect(401);
    expect(find).not.toHaveBeenCalled();
  });
});
