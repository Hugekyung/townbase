import { Controller, Get, Param, Post, Req, Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { AuthModule } from "../src/auth/auth.module";
import { AuthService } from "../src/auth/auth.service";
import {
  AccessService,
  type AccessRequest,
} from "../src/access/access.service";
import { configureSelfHostedHttp } from "../src/deployment/self-hosted-http";
const principal = {
  administratorId: "admin-a",
  installationId: "primary",
  workspaceId: "workspace-a",
  username: "admin",
  expiresAt: "2030-01-01T00:00:00.000Z",
};
const writes = jest.fn();
const resources: Record<
  string,
  { workspaceId: unknown; ownerAdministratorId: unknown }
> = {
  own: { workspaceId: "workspace-a", ownerAdministratorId: "admin-a" },
  foreign: { workspaceId: "workspace-b", ownerAdministratorId: "admin-a" },
  otherOwner: { workspaceId: "workspace-a", ownerAdministratorId: "admin-b" },
  nullOwner: { workspaceId: "workspace-a", ownerAdministratorId: null },
  missingOwner: { workspaceId: "workspace-a", ownerAdministratorId: undefined },
};
// Test-only handlers verify default protection without publishing unfinished APIs.
@Controller("access-fixture")
class FixtureController {
  constructor(private readonly access: AccessService) {}
  @Get("identity") identity(@Req() req: AccessRequest) {
    const context = this.access.requester(req);
    return {
      administratorId: context.administratorId,
      installationId: context.installationId,
      workspaceId: context.workspaceId,
    };
  }
  @Get("resource/:id") resource(
    @Req() req: AccessRequest,
    @Param("id") id: string,
  ) {
    this.access.assertOwnedResource(req, resources[id]!);
    return { allowed: true };
  }
  @Post("mutation") mutate(@Req() req: AccessRequest) {
    this.access.assertInstallation(req, "primary");
    writes();
    return { saved: true };
  }
}
describe("default administrator and scope protection", () => {
  let app: NestExpressApplication;
  const auth = { requester: jest.fn() };
  const env = { ...process.env };
  beforeEach(async () => {
    process.env.TOWNBASE_SETUP_LOCAL_HTTP = "1";
    delete process.env.TOWNBASE_PUBLIC_ORIGIN;
    writes.mockReset();
    auth.requester.mockReset();
    auth.requester.mockImplementation(async (token) =>
      token === "a".repeat(43)
        ? { ok: true, requester: principal }
        : { ok: false, code: "unauthorized" },
    );
    jest.spyOn(Logger, "error").mockImplementation(() => {});
    const module = await Test.createTestingModule({
      imports: [AuthModule],
      controllers: [FixtureController],
    })
      .overrideProvider(AuthService)
      .useValue(auth)
      .compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    configureSelfHostedHttp(app);
    await app.init();
  });
  afterEach(async () => {
    await app.close();
    jest.restoreAllMocks();
    process.env = { ...env };
  });
  const get = (path: string, cookie = true) => {
    const call = request(app.getHttpServer())
      .get(path)
      .set("Host", "localhost:3000")
      .set("X-Townbase-Auth", "1");
    return cookie
      ? call.set("Cookie", `townbase_session=${"a".repeat(43)}`)
      : call;
  };
  it("protects unannotated handlers and obtains identity only from the session", async () => {
    await get("/access-fixture/identity", false)
      .set("x-administrator-id", "admin-a")
      .expect(401);
    await get("/access-fixture/identity").expect(200).expect(principalSubset());
    await get("/auth/session").expect(200).expect({
      authenticated: true,
      username: "admin",
      expiresAt: principal.expiresAt,
    });
  });
  it.each(["workspaceId", "installationId", "administratorId"])(
    "rejects forged or repeated %s query claims",
    async (field) => {
      await get(`/access-fixture/identity?${field}=other`).expect(403);
      await get(
        `/access-fixture/identity?${field}=${principal[field as keyof typeof principal]}&${field}=other`,
      ).expect(403);
      await get(
        `/access-fixture/identity?${field}=${principal[field as keyof typeof principal]}`,
      ).expect(200);
    },
  );
  it.each(["x-workspace-id", "x-installation-id", "x-administrator-id"])(
    "rejects forged %s headers",
    async (header) => {
      await get("/access-fixture/identity").set(header, "other").expect(403);
    },
  );
  it.each(["foreign", "otherOwner", "missingOwner", "nullOwner", "absent"])(
    "rejects stored foreign/missing scope: %s",
    async (id) => {
      await get(`/access-fixture/resource/${id}`).expect(403);
    },
  );
  it("accepts only the same workspace and owner, and never trusts a caller-made context", async () => {
    await get("/access-fixture/resource/own").expect(200);
    const access = app.get(AccessService);
    expect(() => access.requester({ requester: principal })).toThrow();
    expect(() => access.assertInstallation({}, "primary")).toThrow();
  });
  it("does not retain a previous requester when the same request fails a new check", async () => {
    const access = app.get(AccessService);
    const req: AccessRequest = {
      method: "GET",
      headers: {
        host: "localhost:3000",
        "x-townbase-auth": "1",
        cookie: `townbase_session=${"a".repeat(43)}`,
      },
      socket: {},
    };
    await access.authenticate(req);
    expect(Object.isFrozen(access.requester(req))).toBe(true);
    expect(() => access.assertInstallation(req, "other")).toThrow();
    expect(() =>
      access.assertWorkspaceResource(req, { workspaceId: null }),
    ).toThrow();
    delete req.headers.cookie;
    await expect(access.authenticate(req)).rejects.toThrow();
    expect(() => access.requester(req)).toThrow();
  });
  it("rejects incomplete stored identity instead of accepting missing ownership fields", async () => {
    auth.requester.mockResolvedValue({
      ok: true,
      requester: { username: "admin", installationId: "primary" },
    });
    await get("/access-fixture/identity").expect(503);
    await get("/access-fixture/resource/missingOwner").expect(503);
    expect(writes).not.toHaveBeenCalled();
  });
  it("checks body scope before a protected mutation has any side effect", async () => {
    const post = () =>
      request(app.getHttpServer())
        .post("/access-fixture/mutation")
        .set("Host", "localhost:3000")
        .set("Origin", "http://localhost:3000")
        .set("X-Townbase-Auth", "1")
        .set("Cookie", `townbase_session=${"a".repeat(43)}`);
    await post().send({ workspaceId: "other" }).expect(403);
    expect(writes).not.toHaveBeenCalled();
    await post().send({ workspaceId: "workspace-a" }).expect(201);
    expect(writes).toHaveBeenCalledTimes(1);
  });
  it("requires transport, fails closed on storage outages and does not leak diagnostic errors", async () => {
    await get("/access-fixture/identity")
      .set("Origin", "http://other.example")
      .expect(403);
    await get("/access-fixture/identity")
      .set("X-Townbase-Auth", "0")
      .expect(403);
    auth.requester.mockRejectedValue(
      Object.assign(new Error("secret-token-database-url"), { code: "P1001" }),
    );
    const response = await get("/access-fixture/identity")
      .expect(503)
      .expect("Cache-Control", "no-store");
    expect(JSON.stringify(response.body)).not.toContain("secret");
    expect(Logger.error).toHaveBeenCalledWith(
      "Authentication operation failed [access:database_unavailable].",
    );
    expect(
      JSON.stringify((Logger.error as jest.Mock).mock.calls),
    ).not.toContain("secret");
  });
});
function principalSubset() {
  return {
    administratorId: principal.administratorId,
    installationId: principal.installationId,
    workspaceId: principal.workspaceId,
  };
}
