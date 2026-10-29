import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { mkdtemp, mkdir, rm, symlink, readdir } from "node:fs/promises";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";

import { FileManagementService } from "../src/files/file-management.service";
import { DeploymentDatabase } from "../src/deployment/deployment-database";
import { DeploymentModule } from "../src/deployment/deployment.module";
import { resolveRuntimeProfile } from "../src/runtime-profile";
import { ChatMcpServer } from "../src/chat/chat.server";
import { AuthService } from "../src/auth/auth.service";
import { SetupService } from "../src/setup/setup.service";

describe("runtime profiles", () => {
  it("defaults production to the isolated self-hosted module", () => {
    expect(resolveRuntimeProfile({ NODE_ENV: "production" })).toBe(
      "self_hosted",
    );
    expect(resolveRuntimeProfile({})).toBe("self_hosted");
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
      .overrideProvider(FileManagementService)
      .useValue({})
      .overrideProvider(DeploymentDatabase)
      .useValue({ check })
      .overrideProvider(AuthService)
      .useValue({})
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

  it("keeps legacy and unfinished routes absent with or without a session cookie", async () => {
    const routes = [
      ["post", "/admin/sync/repos"],
      ["post", "/admin/sync/notion"],
      ["get", "/knowledge-gaps"],
      ["patch", "/knowledge-gaps/id/status"],
      ["post", "/knowledge-gaps/id/draft"],
      ["get", "/knowledge-gaps/id/drafts"],
      ["get", "/knowledge-gaps/id/drafts/draft-id"],
      ["post", "/mcp"],
      ["get", "/mcp"],
      ["post", "/chat"],
      ["get", "/documents/id"],
      ["get", "/documents/id/file"],
      ["get", "/conversations/id"],
      ["get", "/settings/key"],
      ["get", "/runs/id"],
      ["get", "/access-fixture/identity"],
      ["get", "/var/lib/townbase/bootstrap/token"],
      ["get", "/var/lib/townbase/recovery/token"],
    ] as const;
    for (const cookie of [undefined, "townbase_session=" + "a".repeat(43)]) {
      for (const [method, route] of routes) {
        const call = request(app.getHttpServer())
          [method](route)
          .set("Host", "localhost:3000")
          .set("Origin", "http://localhost:3000")
          .set("X-Townbase-Auth", "1");
        if (cookie) call.set("Cookie", cookie);
        if (method !== "get") call.send({ workspaceId: "forged" });
        await call.expect(404);
      }
    }
    expect(() => app.get(ChatMcpServer, { strict: false })).toThrow();
  });
});
