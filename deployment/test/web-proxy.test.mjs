import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { once } from "node:events";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import webConfig from "../../apps/web/vite.config.ts";

const requireWeb = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);
const { createServer } = await import(
  pathToFileURL(requireWeb.resolve("vite"))
);

test("Vite forwards readiness, setup, authentication and integration settings while preserving the browser origin boundary", async () => {
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        path: req.url,
        method: req.method,
        host: req.headers.host,
        origin: req.headers.origin,
        setup: req.headers["x-townbase-setup"],
        auth: req.headers["x-townbase-auth"],
        cookie: req.headers.cookie,
        contentType: req.headers["content-type"],
        body,
        forwarded: [
          "x-forwarded-host",
          "x-forwarded-for",
          "x-forwarded-proto",
        ].filter((h) => req.headers[h] != null),
      }),
    );
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  let vite;
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "townbase-vite-test-"));
  try {
    const target = `http://127.0.0.1:${upstream.address().port}`;
    const proxy = Object.fromEntries(
      Object.entries(webConfig.server.proxy).map(([route, options]) => [
        route,
        typeof options === "string" ? target : { ...options, target },
      ]),
    );
    vite = await createServer({
      ...webConfig,
      configFile: false,
      cacheDir,
      optimizeDeps: { noDiscovery: true, include: [] },
      logLevel: "silent",
      root: fileURLToPath(new URL("../../apps/web", import.meta.url)),
      server: {
        ...webConfig.server,
        host: "127.0.0.1",
        port: 0,
        proxy,
        watch: null,
        ws: false,
      },
    });
    await vite.listen();
    const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
    const payload = JSON.stringify({
      token: "synthetic-proxy-token",
      username: "합성 운영자",
      password: "synthetic-proxy-password-only",
    });
    for (const [route, method] of [
      ["/readyz", "GET"],
      ["/setup/status", "GET"],
      ["/setup/administrator", "POST"],
      ["/auth/session", "GET"],
      ["/auth/login", "POST"],
      ["/auth/logout", "POST"],
      ["/auth/password", "POST"],
      ["/auth/recover", "POST"],
      ["/settings/model-integration", "GET"],
      ["/settings/model-integration/credentials/embedding", "PUT"],
      ["/settings/model-integration/credentials/embedding/disable", "POST"],
      ["/settings/model-integration/credentials/embedding", "DELETE"],
      ["/settings/model-integration/transfers", "PUT"],
    ]) {
      const response = await fetch(`${origin}${route}`, {
        method,
        headers: {
          Origin: origin,
          "X-Townbase-Setup": "1",
          "X-Townbase-Auth": "1",
          Cookie: "townbase_session=synthetic-cookie",
          "Content-Type": "application/json",
        },
        ...(!["GET", "HEAD"].includes(method) ? { body: payload } : {}),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        path: route,
        method,
        host: new URL(origin).host,
        origin,
        setup: "1",
        auth: "1",
        cookie: "townbase_session=synthetic-cookie",
        contentType: "application/json",
        body: !["GET", "HEAD"].includes(method) ? payload : "",
        forwarded: [],
      });
    }
  } finally {
    await vite?.close();
    await new Promise((resolve, reject) =>
      upstream.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(cacheDir, { recursive: true, force: true });
  }
});
