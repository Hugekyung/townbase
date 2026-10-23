import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { SetupController } from "../src/setup/setup.controller";
import { SetupService } from "../src/setup/setup.service";

describe("setup HTTP boundary", () => {
  let app: INestApplication;
  const register = jest.fn();
  const status = jest.fn();
  const original = {
    TOWNBASE_SETUP_LOCAL_HTTP: process.env.TOWNBASE_SETUP_LOCAL_HTTP,
    TOWNBASE_PUBLIC_ORIGIN: process.env.TOWNBASE_PUBLIC_ORIGIN,
    TOWNBASE_TRUSTED_PROXY_IP: process.env.TOWNBASE_TRUSTED_PROXY_IP,
  };
  beforeAll(async () => {
    process.env.TOWNBASE_SETUP_LOCAL_HTTP = "1";
    delete process.env.TOWNBASE_PUBLIC_ORIGIN;
    delete process.env.TOWNBASE_TRUSTED_PROXY_IP;
    const module = await Test.createTestingModule({
      controllers: [SetupController],
      providers: [{ provide: SetupService, useValue: { register, status } }],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  beforeEach(() => {
    register.mockReset().mockResolvedValue("registered");
    status.mockReset().mockResolvedValue({ state: "required" });
  });
  afterAll(async () => {
    await app.close();
    for (const [key, value] of Object.entries(original)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const post = () =>
    request(app.getHttpServer())
      .post("/setup/administrator")
      .set("Host", "127.0.0.1:43140")
      .set("Origin", "http://127.0.0.1:43140")
      .set("X-Townbase-Setup", "1");
  it("returns state only, not credentials, and disables response caching", async () => {
    await request(app.getHttpServer())
      .get("/setup/status")
      .expect(200)
      .expect("Cache-Control", "no-store")
      .expect({ state: "required" });
    await post()
      .send({
        token: "synthetic-canary",
        username: "operator",
        password: "synthetic-password",
      })
      .expect(201)
      .expect({ state: "complete", administratorCreated: true });
  });
  it("rejects foreign origins before calling registration", async () => {
    await post().set("Origin", "https://evil.example").send({}).expect(403);
    expect(register).not.toHaveBeenCalled();
  });
  it.each([
    ["closed", 409],
    ["invalid_token", 401],
    ["invalid_request", 400],
    ["throttled", 429],
  ] as const)(
    "maps %s without exposing submitted values",
    async (code, httpStatus) => {
      register.mockResolvedValueOnce(code);
      const res = await post()
        .send({ password: "secret-canary" })
        .expect(httpStatus);
      expect(res.body).toEqual({ code });
      expect(JSON.stringify(res.body)).not.toContain("secret-canary");
    },
  );
  it("redacts unexpected persistence errors and never exposes a token issue route", async () => {
    register.mockRejectedValueOnce(new Error("password-hash-secret-canary"));
    await post().send({}).expect(503).expect({ code: "setup_unavailable" });
    status.mockRejectedValueOnce(new Error("secret-canary"));
    await request(app.getHttpServer())
      .get("/setup/status")
      .expect(503)
      .expect({ code: "setup_unavailable" });
    await request(app.getHttpServer())
      .post("/setup/token")
      .send({})
      .expect(404);
  });
});
