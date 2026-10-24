import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
const root = fileURLToPath(new URL("../../", import.meta.url));
const preload = fileURLToPath(new URL("./deny-network.cjs", import.meta.url));
const fixture = fileURLToPath(
  new URL("./mcp-startup-failure.fixture.cjs", import.meta.url),
);
for (const stage of ["application", "transport"])
  test(`MCP exits on ${stage} failure even with a live handle, and logs no secrets`, () => {
    const result = spawnSync(
      process.execPath,
      [
        "--require",
        preload,
        "--require",
        fixture,
        "apps/api/dist/chat/mcp-entrypoint.js",
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          NODE_ENV: "test",
          TOWNBASE_RUNTIME_PROFILE: "legacy_development",
          TOWNBASE_MCP_FAILURE_FIXTURE: stage,
          DATABASE_URL: "postgresql://secret-canary@127.0.0.1:1/forbidden",
          OPENAI_API_KEY: "secret-canary",
        },
        input: "",
        encoding: "utf8",
        timeout: 15000,
      },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(
      result.stderr.trim(),
      `MCP startup failed [${stage}]. Check development configuration.`,
    );
    assert.ok(!result.stderr.includes("secret-canary"));
  });
