import { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AuthController } from "../src/auth/auth.controller";
import { AuthService } from "../src/auth/auth.service";
import {
  authTransportAllowed,
  readSessionCookie,
  sessionCookie,
} from "../src/auth/auth-transport";
import { validPassword } from "../src/auth/auth-policy";
import { configureSelfHostedHttp } from "../src/deployment/self-hosted-http";

describe("authentication HTTP boundary", () => {
  let app: NestExpressApplication;
  const auth = {
    login: jest.fn(),
    current: jest.fn(),
    logout: jest.fn(),
    changePassword: jest.fn(),
    recover: jest.fn(),
  };
  const env = { ...process.env };
  beforeEach(async () => {
    process.env.TOWNBASE_SETUP_LOCAL_HTTP = "1";
    delete process.env.TOWNBASE_PUBLIC_ORIGIN;
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: auth }],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    configureSelfHostedHttp(app);
    await app.init();
  });
  afterEach(async () => {
    await app.close();
    process.env = { ...env };
  });
  const post = (path: string) =>
    request(app.getHttpServer())
      .post(`/auth/${path}`)
      .set("Host", "localhost:3000")
      .set("Origin", "http://localhost:3000")
      .set("X-Townbase-Auth", "1");
  it("sets only an HttpOnly same-site cookie and never returns the session token", async () => {
    auth.login.mockResolvedValue({
      ok: true,
      token: "a".repeat(43),
      username: "admin",
    });
    const response = await post("login")
      .send({ username: "admin", password: "long test password" })
      .expect(200)
      .expect("Cache-Control", "no-store");
    expect(response.body).toEqual({ authenticated: true, username: "admin" });
    expect(response.headers["set-cookie"]![0]).toBe(
      sessionCookie("a".repeat(43)),
    );
    expect(response.headers["set-cookie"]![0]).toContain(
      "HttpOnly; SameSite=Strict",
    );
  });
  it.each(["login", "logout", "password", "recover"])(
    "protects every %s mutation before calling the service",
    async (path) => {
      await request(app.getHttpServer())
        .post(`/auth/${path}`)
        .send({})
        .expect(403);
      await post(path)
        .set("Origin", "http://other.example")
        .send({})
        .expect(403);
      await post(path).set("X-Forwarded-Proto", "https").send({}).expect(403);
      await post(path).type("text").send("{}").expect(415);
      expect(
        Object.values(auth).every((fn) => fn.mock.calls.length === 0),
      ).toBe(true);
    },
  );
  it("permits same-origin session reads without an Origin header but requires the custom marker", async () => {
    auth.current.mockResolvedValue({ ok: false, code: "unauthorized" });
    await request(app.getHttpServer())
      .get("/auth/session")
      .set("Host", "localhost:3000")
      .expect(403);
    await request(app.getHttpServer())
      .get("/auth/session")
      .set("Host", "localhost:3000")
      .set("X-Townbase-Auth", "1")
      .expect(401);
  });
  it("maps service failures without leaking internal errors and clears logout cookies", async () => {
    auth.login.mockResolvedValue({ ok: false, code: "throttled" });
    await post("login").send({}).expect(429);
    auth.login.mockRejectedValue(new Error("secret database password"));
    const failed = await post("login").send({}).expect(503);
    expect(JSON.stringify(failed.body)).not.toContain("secret");
    auth.logout.mockResolvedValue({ ok: true });
    const response = await post("logout").send({}).expect(200);
    expect(response.headers["set-cookie"]![0]).toContain("Max-Age=0");
    await post("logout").send({ unexpected: true }).expect(400);
  });
  it("enforces TLS proxy trust and Secure cookies for the approved public origin", () => {
    process.env.TOWNBASE_PUBLIC_ORIGIN = "https://townbase.example";
    process.env.TOWNBASE_TRUSTED_PROXY_IP = "127.0.0.1";
    const req = {
      headers: {
        host: "townbase.example",
        origin: "https://townbase.example",
        "x-townbase-auth": "1",
        "x-forwarded-proto": "https",
      },
      socket: { remoteAddress: "::ffff:127.0.0.1" },
    };
    expect(authTransportAllowed(req)).toBe(true);
    expect(
      authTransportAllowed({ ...req, socket: { remoteAddress: "127.0.0.2" } }),
    ).toBe(false);
    expect(
      authTransportAllowed({
        ...req,
        headers: { ...req.headers, "x-forwarded-proto": "http" },
      }),
    ).toBe(false);
    expect(sessionCookie("a".repeat(43))).toContain("; Secure");
  });
  it("rejects malformed/duplicate cookies and counts Unicode password code points", () => {
    const cookie = (value: string) =>
      readSessionCookie({ headers: { cookie: value }, socket: {} });
    expect(cookie(`other=1; townbase_session=${"a".repeat(43)}`)).toBe(
      "a".repeat(43),
    );
    expect(
      cookie(
        `townbase_session=${"a".repeat(43)}; townbase_session=${"b".repeat(43)}`,
      ),
    ).toBeUndefined();
    expect(cookie("townbase_session=bad%value")).toBeUndefined();
    expect(validPassword("🙂".repeat(15))).toBe(true);
    expect(validPassword("🙂".repeat(129))).toBe(false);
    expect(validPassword("x".repeat(14))).toBe(false);
  });
});
