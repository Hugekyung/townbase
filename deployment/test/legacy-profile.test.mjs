import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
const root = fileURLToPath(new URL("../../", import.meta.url));
const databaseRequire = createRequire(
  new URL("../../packages/database/package.json", import.meta.url),
);
const seedRunner = databaseRequire.resolve("ts-node/dist/bin.js");
const preload = fileURLToPath(new URL("./deny-network.cjs", import.meta.url));
const entries = [
  ["Notion CLI", ["packages/connectors/dist/sync.js"]],
  ["local Git CLI", ["packages/connectors/dist/local-repo/entrypoint.js"]],
  ["MCP stdio", ["apps/api/dist/chat/mcp-entrypoint.js"]],
  [
    "legacy evaluation",
    [
      seedRunner,
      "--project",
      "apps/api/tsconfig.json",
      "apps/api/src/evaluation/task-107-vector-only-baseline.ts",
    ],
  ],
  [
    "development seed",
    [
      seedRunner,
      "--project",
      "packages/database/tsconfig.json",
      "packages/database/prisma/seed.ts",
    ],
  ],
];
for (const [name, args] of entries)
  test(`${name} refuses self-hosted/production before DB, sources or model work`, () => {
    for (const [nodeEnv, profile, message, diagnostic] of [
      [
        "production",
        "self_hosted",
        "Legacy entry points are unavailable in the self-hosted profile",
        "legacy_in_self_hosted",
      ],
      [
        "production",
        "legacy_development",
        "Legacy routes are unavailable in production",
        "legacy_in_production",
      ],
      [
        undefined,
        undefined,
        "Legacy entry points are unavailable in the self-hosted profile",
        "legacy_in_self_hosted",
      ],
      [
        "development",
        undefined,
        "Legacy entry points are unavailable in the self-hosted profile",
        "legacy_in_self_hosted",
      ],
      [
        "production",
        "unknown",
        "Unsupported runtime profile",
        "unsupported_profile",
      ],
    ]) {
      const env = { ...process.env };
      delete env.NODE_ENV;
      delete env.TOWNBASE_RUNTIME_PROFILE;
      if (nodeEnv != null) env.NODE_ENV = nodeEnv;
      if (profile != null) env.TOWNBASE_RUNTIME_PROFILE = profile;
      const result = spawnSync(
        process.execPath,
        ["--require", preload, ...args],
        {
          cwd: root,
          env: {
            ...env,
            DATABASE_URL: "postgresql://canary-secret@127.0.0.1:1/forbidden",
            OPENAI_API_KEY: "canary-secret",
            NOTION_API_KEY: "canary-secret",
            NOTION_ROOT_PAGE_ID: "canary-root",
            OPENAI_EMBEDDING_BASE_URL: "http://127.0.0.1:1",
            REPO_ROOT_PATH: "/tmp/townbase-b05-no-sources",
          },
          encoding: "utf8",
          input: "",
          timeout: 15000,
        },
      );
      assert.equal(result.error, undefined);
      assert.equal(result.status, 1);
      const output = result.stdout + result.stderr;
      if (name === "MCP stdio") {
        assert.equal(
          result.stderr.trim(),
          `MCP startup failed [runtime-profile:${diagnostic}]. Check runtime profile.`,
        );
      } else {
        assert.ok(output.includes(message), output);
      }
      assert.ok(!output.includes("canary-secret"));
      if (name === "MCP stdio") assert.equal(result.stdout, "");
    }
  });
