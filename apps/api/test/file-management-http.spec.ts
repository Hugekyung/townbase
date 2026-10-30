import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { AuthModule } from "../src/auth/auth.module";
import { AuthService } from "../src/auth/auth.service";
import { FileManagementController } from "../src/files/file-management.controller";
import { FileRunService } from "../src/files/file-run.service";
import { FileManagementService } from "../src/files/file-management.service";
import { configureSelfHostedHttp } from "../src/deployment/self-hosted-http";

const principal = {
  administratorId: "admin",
  installationId: "primary",
  workspaceId: "workspace",
  username: "admin",
  expiresAt: "2030-01-01T00:00:00.000Z",
};
describe("D02 real HTTP body/guard boundary", () => {
  let app: NestExpressApplication;
  const auth = { requester: jest.fn() };
  const files = {
    list: jest.fn(),
    read: jest.fn(),
    reference: jest.fn(),
    register: jest.fn(),
    remove: jest.fn(),
  };
  const environment = { ...process.env };
  beforeAll(async () => {
    process.env.TOWNBASE_SETUP_LOCAL_HTTP = "1";
    delete process.env.TOWNBASE_PUBLIC_ORIGIN;
    jest.spyOn(Logger, "error").mockImplementation(() => {});
    const module = await Test.createTestingModule({
      imports: [AuthModule],
      controllers: [FileManagementController],
      providers: [
        { provide: FileManagementService, useValue: files },
        {
          provide: FileRunService,
          useValue: {
            upload: (
              token: unknown,
              context: unknown,
              _id: unknown,
              name: unknown,
              bytes: unknown,
              target: unknown,
            ) => files.register(token, context, name, bytes, target),
          },
        },
      ],
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
  beforeEach(() => {
    jest.clearAllMocks();
    auth.requester.mockImplementation(async (token) =>
      token === "a".repeat(43)
        ? { ok: true, requester: principal }
        : { ok: false },
    );
    files.register.mockResolvedValue({ stored: true });
    files.list.mockResolvedValue({ items: [] });
  });
  afterAll(async () => {
    await app.close();
    process.env = environment;
    jest.restoreAllMocks();
  });
  const headers = {
    Host: "127.0.0.1:3000",
    Origin: "http://127.0.0.1:3000",
    "X-Townbase-Auth": "1",
    Cookie: `townbase_session=${"a".repeat(43)}`,
  };
  test("unauthenticated large/malformed body is rejected before file work", async () => {
    await request(app.getHttpServer())
      .post("/files")
      .set({ ...headers, Cookie: "" })
      .set("Content-Type", "application/json")
      .send("{".repeat(9000))
      .expect(401);
    expect(files.register).not.toHaveBeenCalled();
  });
  test("accepts authenticated body over legacy8KB and repeats auth after parsing", async () => {
    await request(app.getHttpServer())
      .post("/files")
      .set(headers)
      .send({
        name: "a.txt",
        contentBase64: Buffer.alloc(9000, 120).toString("base64"),
      })
      .expect(202);
    expect(auth.requester).toHaveBeenCalledTimes(2);
    expect(files.register.mock.calls[0]?.[3]).toHaveLength(9000);
  });
  test.each([
    ["post", "/files/", 202],
    ["post", "/FILES/?from=test", 202],
    ["put", "/files/11111111-1111-4111-8111-111111111111/", 202],
    ["put", "/FILES/11111111-1111-4111-8111-111111111111/?from=test", 202],
  ] as const)(
    "%s %s uses the authenticated large upload boundary",
    async (method, path, status) => {
      await request(app.getHttpServer())
        [method](path)
        .set(headers)
        .send({
          name: "a.txt",
          contentBase64: Buffer.alloc(9000, 120).toString("base64"),
        })
        .expect(status);
      expect(auth.requester).toHaveBeenCalledTimes(2);
      expect(files.register).toHaveBeenCalledTimes(1);
      expect(files.register.mock.calls[0]?.[3]).toHaveLength(9000);
    },
  );
  test("trailing slash upload is authenticated before its malformed large body", async () => {
    await request(app.getHttpServer())
      .post("/files/")
      .set({ ...headers, Cookie: "" })
      .set("Content-Type", "application/json")
      .send("{".repeat(9000))
      .expect(401);
    expect(files.register).not.toHaveBeenCalled();
  });
  test.each([{ unexpected: true }, [], null, "value", 1])(
    "DELETE rejects non-empty/non-object JSON %j before removal",
    async (body) => {
      await request(app.getHttpServer())
        .delete("/files/11111111-1111-4111-8111-111111111111")
        .set(headers)
        .set("Content-Type", "application/json")
        .send(JSON.stringify(body))
        .expect(400);
      expect(files.remove).not.toHaveBeenCalled();
    },
  );
  test("DELETE permits exactly an empty JSON object", async () => {
    files.remove.mockResolvedValue({ deleted: true });
    await request(app.getHttpServer())
      .delete("/files/11111111-1111-4111-8111-111111111111")
      .set(headers)
      .send({})
      .expect(200);
    expect(files.remove).toHaveBeenCalledTimes(1);
  });
  test.each([
    "text/plain",
    "application/octet-stream",
    "multipart/form-data; boundary=a",
  ])("rejects upload Content-Type %s", async (type) => {
    await request(app.getHttpServer())
      .post("/files")
      .set(headers)
      .set("Content-Type", type)
      .send("body")
      .expect(415);
    expect(files.register).not.toHaveBeenCalled();
  });
  test("rejects compressed uploads independently of body parsing", async () => {
    await request(app.getHttpServer())
      .post("/files")
      .set(headers)
      .set("Content-Type", "application/json")
      .set("Content-Encoding", "gzip")
      .send("bad gzip")
      .expect(415);
  });
  test("keeps small request cap for unrelated routes", async () => {
    await request(app.getHttpServer())
      .post("/auth/login")
      .set(headers)
      .send({ password: "x".repeat(9000) })
      .expect(413);
  });
  test("rejects a session revoked during parsing", async () => {
    auth.requester
      .mockResolvedValueOnce({ ok: true, requester: principal })
      .mockResolvedValueOnce({ ok: false });
    await request(app.getHttpServer())
      .post("/files")
      .set(headers)
      .send({ name: "a.txt", contentBase64: "eA==" })
      .expect(401);
    expect(files.register).not.toHaveBeenCalled();
  });
  test("rejects scope claim in parsed body", async () => {
    await request(app.getHttpServer())
      .post("/files")
      .set(headers)
      .send({ name: "a.txt", contentBase64: "eA==", workspaceId: "foreign" })
      .expect(403);
    expect(files.register).not.toHaveBeenCalled();
  });
  test("a second large upload is rejected while the first response is pending", async () => {
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    files.register.mockImplementationOnce(async () => {
      entered();
      await gate;
      return { stored: true };
    });
    const first = request(app.getHttpServer())
      .post("/files")
      .set(headers)
      .send({ name: "a.txt", contentBase64: "eA==" })
      .then((res) => res);
    try {
      await started;
      await request(app.getHttpServer())
        .post("/files")
        .set(headers)
        .send({ name: "b.txt", contentBase64: "eA==" })
        .expect(409);
    } finally {
      release();
    }
    expect((await first).status).toBe(202);
    // Completion must free the slot exactly once, even when close follows finish.
    await request(app.getHttpServer())
      .post("/files")
      .set(headers)
      .send({ name: "c.txt", contentBase64: "eA==" })
      .expect(202);
  });
  test("downloads only as no-store attachment", async () => {
    files.reference.mockResolvedValue({
      bytes: Buffer.from("safe"),
      name: "a'한글.txt",
    });
    const res = await request(app.getHttpServer())
      .get("/files/11111111-1111-4111-8111-111111111111/reference")
      .set(headers)
      .expect(200);
    expect(res.headers["content-disposition"]).toMatch(/^attachment;/);
    expect(res.headers["content-disposition"]).toContain("%27");
    expect(res.headers["content-type"]).toBe("application/octet-stream");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});
