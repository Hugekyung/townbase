import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { mkdtemp, mkdir, rm, symlink, readdir } from "node:fs/promises";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";

import { DeploymentDatabase } from "../src/deployment/deployment-database";
import { DeploymentModule } from "../src/deployment/deployment.module";
import { resolveRuntimeProfile } from "../src/runtime-profile";
import { ChatMcpServer } from "../src/chat/chat.server";
import { SetupService } from "../src/setup/setup.service";

describe("runtime profiles", () => {
  it("defaults production to the isolated self-hosted module", () => {
    expect(resolveRuntimeProfile({ NODE_ENV: "production" })).toBe(
      "self_hosted",
    );
    expect(resolveRuntimeProfile({})).toBe("legacy_development");
  });
  it("rejects legacy production and unknown profiles", () => {
    expect(() =>
      resolveRuntimeProfile({
        NODE_ENV: "production",
        TOWNBASE_RUNTIME_PROFILE: "legacy_development",
      }),
    ).toThrow();
    expect(() =>
      resolveRuntimeProfile({ TOWNBASE_RUNTIME_PROFILE: "typo" }),
    ).toThrow();
  });
});

describe("self-hosted deployment surface", () => {
  let app: INestApplication;
  let directory: string;
  const original = {
    documents: process.env.TOWNBASE_DOCUMENTS_PATH,
    attachments: process.env.TOWNBASE_ATTACHMENTS_PATH,
  };
  const check = jest.fn();
  const setupStatus = jest.fn();

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "townbase-deployment-"));
    process.env.TOWNBASE_DOCUMENTS_PATH = path.join(directory, "documents");
    process.env.TOWNBASE_ATTACHMENTS_PATH = path.join(directory, "attachments");
    await mkdir(process.env.TOWNBASE_DOCUMENTS_PATH);
    await mkdir(process.env.TOWNBASE_ATTACHMENTS_PATH);
    check.mockResolvedValue({ database: "ready", schema: "ready" });
    setupStatus.mockResolvedValue({ state: "required" });
    const module = await Test.createTestingModule({
      imports: [DeploymentModule],
    })
      .overrideProvider(DeploymentDatabase)
      .useValue({ check })
      .overrideProvider(SetupService)
      .useValue({ status: setupStatus })
      .compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
    await rm(directory, { recursive: true, force: true });
    if (original.documents == null) delete process.env.TOWNBASE_DOCUMENTS_PATH;
    else process.env.TOWNBASE_DOCUMENTS_PATH = original.documents;
    if (original.attachments == null)
      delete process.env.TOWNBASE_ATTACHMENTS_PATH;
    else process.env.TOWNBASE_ATTACHMENTS_PATH = original.attachments;
  });

  it("reports infrastructure readiness without claiming signup or chat is available", async () => {
    await request(app.getHttpServer())
      .get("/readyz")
      .expect(200)
      .expect("Cache-Control", "no-store")
      .expect({
        database: "ready",
        schema: "ready",
        storage: "ready",
        setup: "required",
        capabilities: { administratorSetup: true, chat: false },
      });
  });

  it("returns 503 for database and migration failures", async () => {
    check.mockResolvedValue({ database: "unavailable", schema: "unavailable" });
    await request(app.getHttpServer()).get("/readyz").expect(503);
    check.mockResolvedValue({ database: "ready", schema: "unavailable" });
    await request(app.getHttpServer()).get("/readyz").expect(503);
    await request(app.getHttpServer()).get("/health").expect(200);
  });

  it("returns 503 for missing or shared storage", async () => {
    process.env.TOWNBASE_ATTACHMENTS_PATH = path.join(directory, "missing");
    await request(app.getHttpServer()).get("/readyz").expect(503);
    process.env.TOWNBASE_ATTACHMENTS_PATH = process.env.TOWNBASE_DOCUMENTS_PATH;
    await request(app.getHttpServer()).get("/readyz").expect(503);
    const nested = path.join(process.env.TOWNBASE_DOCUMENTS_PATH!, "..nested");
    await mkdir(nested);
    process.env.TOWNBASE_ATTACHMENTS_PATH = nested;
    await request(app.getHttpServer()).get("/readyz").expect(503);
    const alias = path.join(directory, "alias");
    await symlink(process.env.TOWNBASE_DOCUMENTS_PATH!, alias);
    process.env.TOWNBASE_ATTACHMENTS_PATH = alias;
    await request(app.getHttpServer()).get("/readyz").expect(503);
  });

  it("removes successful write probes from both storage directories", async () => {
    await request(app.getHttpServer()).get("/readyz").expect(200);
    expect(await readdir(process.env.TOWNBASE_DOCUMENTS_PATH!)).toEqual([]);
    expect(await readdir(process.env.TOWNBASE_ATTACHMENTS_PATH!)).toEqual([]);
  });

  it("rejects full storage even when directory permissions allow access", async () => {
    jest
      .spyOn(fs, "open")
      .mockRejectedValueOnce(
        Object.assign(new Error("private-path-canary"), { code: "ENOSPC" }),
      );
    const response = await request(app.getHttpServer())
      .get("/readyz")
      .expect(503);
    expect(response.body.storage).toBe("unavailable");
    expect(JSON.stringify(response.body)).not.toContain("private-path-canary");
  });

  it("closes and deletes a probe when writing fails after creating it", async () => {
    const originalOpen = fs.open;
    let close: jest.SpyInstance | undefined;
    jest.spyOn(fs, "open").mockImplementationOnce(async (...args) => {
      const file = await originalOpen(...args);
      close = jest.spyOn(file, "close");
      jest
        .spyOn(file, "writeFile")
        .mockRejectedValueOnce(new Error("disk-full"));
      return file;
    });
    await request(app.getHttpServer()).get("/readyz").expect(503);
    expect(close).toHaveBeenCalledTimes(1);
    expect(await readdir(process.env.TOWNBASE_DOCUMENTS_PATH!)).toEqual([]);
  });

  it("does not register legacy ingestion, gap, draft or MCP routes", async () => {
    await request(app.getHttpServer())
      .post("/admin/sync/repos")
      .send({})
      .expect(404);
    await request(app.getHttpServer())
      .post("/admin/sync/notion")
      .send({})
      .expect(404);
    await request(app.getHttpServer()).get("/knowledge-gaps").expect(404);
    await request(app.getHttpServer())
      .post("/knowledge-gaps/id/draft")
      .send({})
      .expect(404);
    await request(app.getHttpServer()).post("/mcp").send({}).expect(404);
    expect(() => app.get(ChatMcpServer, { strict: false })).toThrow();
  });
});
