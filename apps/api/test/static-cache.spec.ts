import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import request from "supertest";
import {
  configureSelfHostedHttp,
  configureSelfHostedStaticAssets,
} from "../src/deployment/self-hosted-http";

describe("self-hosted cache and security boundaries", () => {
  let app: NestExpressApplication;
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "townbase-web-cache-"));
    await mkdir(path.join(root, "assets"));
    await writeFile(
      path.join(root, "index.html"),
      "<!doctype html><title>synthetic fixture</title>",
    );
    await writeFile(
      path.join(root, "assets/app-test.js"),
      "console.log('synthetic fixture');",
    );
    await writeFile(
      path.join(root, "assets/app-test.css"),
      "body { color: black; }",
    );
    const module = await Test.createTestingModule({}).compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    configureSelfHostedHttp(app);
    configureSelfHostedStaticAssets(app, root);
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
    if (root) await rm(root, { recursive: true, force: true });
  });
  it.each(["/assets/app-test.js", "/assets/app-test.css"])(
    "allows revalidation for a real static asset %s",
    async (url) => {
      const first = await request(app.getHttpServer()).get(url).expect(200);
      expect(first.headers["cache-control"]).toBe("public, max-age=0");
      expect(first.headers["x-content-type-options"]).toBe("nosniff");
      expect(first.headers["content-security-policy"]).toContain(
        "form-action 'self'",
      );
      const etag = first.headers.etag;
      if (typeof etag !== "string")
        throw new Error("Static asset must expose an ETag");
      await request(app.getHttpServer())
        .get(url)
        .set("If-None-Match", etag)
        .expect(304)
        .expect("Cache-Control", "public, max-age=0");
      await request(app.getHttpServer())
        .head(url)
        .expect(200)
        .expect("Cache-Control", "public, max-age=0");
    },
  );
  it.each(["/", "/index.html"])(
    "keeps the HTML entrypoint %s non-cacheable",
    async (url) => {
      await request(app.getHttpServer())
        .get(url)
        .expect(200)
        .expect("Cache-Control", "no-store");
    },
  );
  it.each([
    "/assets/missing.js",
    "/assets/../missing",
    "/missing-api",
    "/assets/.secret",
  ])("keeps missing/denied responses %s non-cacheable", async (url) => {
    await request(app.getHttpServer())
      .get(url)
      .expect(404)
      .expect("Cache-Control", "no-store");
  });
  it.each([
    ["Range", "bytes=999999-", 416],
    ["If-Match", '"non-matching-synthetic-etag"', 412],
  ] as const)(
    "keeps post-file-lookup %s failures non-cacheable",
    async (header, value, code) => {
      await request(app.getHttpServer())
        .get("/assets/app-test.js")
        .set(header, value)
        .expect(code)
        .expect("Cache-Control", "no-store")
        .expect("X-Content-Type-Options", "nosniff");
    },
  );
  it("allows caching of a successful partial asset response", async () => {
    await request(app.getHttpServer())
      .get("/assets/app-test.js")
      .set("Range", "bytes=0-6")
      .expect(206)
      .expect("Cache-Control", "public, max-age=0");
  });
  it("does not let an assets URL bypass JSON error protection", async () => {
    const response = await request(app.getHttpServer())
      .post("/assets/app-test.js")
      .set("Content-Type", "application/json")
      .send('{"password":"synthetic-canary",')
      .expect(400);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.body).toEqual({ code: "invalid_json" });
    expect(response.text).not.toContain("synthetic-canary");
  });
});
