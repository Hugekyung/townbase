import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, cp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { databaseEnvironment } from "../database-env.mjs";
import { checkFileExtractionUpgrade } from "../file-extraction-preflight.mjs";

// Opt-in fresh disposable DB only. Excluded from the ordinary *.test.mjs glob.
assert.equal(process.env.TOWNBASE_FILE_PREFLIGHT_TEST, "1");
const url = new URL(databaseEnvironment());
assert.equal(url.hostname, "postgres");
assert.equal(url.pathname, "/townbase_d01_pr41_preflight_test");
process.env.DATABASE_URL = url.toString();
const requireDatabase = createRequire(
  new URL("../../packages/database/package.json", import.meta.url),
);
const { PrismaClient } = requireDatabase("./dist/index.js");
const db = new PrismaClient();

test(
  "fresh install and legacy incompatible rows: inspect, block before CLI, repair explicitly, upgrade without data loss",
  { timeout: 120000 },
  async () => {
    let directory;
    try {
      const [fresh] =
        await db.$queryRaw`SELECT to_regclass('public."Workspace"') IS NULL AS empty`;
      assert.equal(
        fresh.empty,
        true,
        "Fresh dedicated preflight DB required; do not reset an existing DB implicitly",
      );
      await checkFileExtractionUpgrade(db); // No table is a supported new-install state.
      directory = await mkdtemp(
        path.join(tmpdir(), "townbase-pr41-migrations-"),
      );
      const source = new URL(
        "../../packages/database/prisma/migrations",
        import.meta.url,
      );
      await cp(source, path.join(directory, "migrations"), { recursive: true });
      await rm(
        path.join(
          directory,
          "migrations/20261028010000_file_extraction_contract",
        ),
        { recursive: true },
      );
      const config = path.join(directory, "prisma.config.mjs");
      await writeFile(
        config,
        `import {createRequire} from 'node:module'; const require=createRequire('/workspace/package.json'); const {defineConfig}=require('prisma/config'); export default defineConfig({schema:'/workspace/packages/database/prisma/schema.prisma',migrations:{path:${JSON.stringify(path.join(directory, "migrations"))}},datasource:{url:process.env.DATABASE_URL}});`,
      );
      execFileSync(
        "pnpm",
        ["exec", "prisma", "migrate", "deploy", "--config", config],
        { cwd: "/workspace", env: process.env, stdio: "pipe", timeout: 60000 },
      );
      const { hashPassword } = createRequire(
        new URL("../../apps/api/package.json", import.meta.url),
      )("./dist/setup/password.js");
      const workspace = await db.workspace.create({
        data: { name: "PR41 legacy synthetic" },
      });
      await db.installation.create({
        data: {
          id: "primary",
          workspaceId: workspace.id,
          name: "PR41 fixture",
          timeZone: "UTC",
          initializedAt: new Date(),
        },
      });
      const administrator = await db.administrator.create({
        data: {
          installationId: "primary",
          username: "pr41-admin",
          passwordHash: await hashPassword(
            "PR41 synthetic preflight password!",
          ),
        },
      });
      const original = await db.fileOriginal.create({
        data: {
          id: randomUUID(),
          installationId: "primary",
          ownerAdministratorId: administrator.id,
          title: "synthetic original",
        },
      });
      const canary = "PR41_ORIGINAL_CONTENT_MUST_NOT_APPEAR";
      const ids = [];
      for (const codePoints of [1, "1"]) {
        const id = randomUUID();
        ids.push(id);
        await db.fileVersion.create({
          data: {
            id,
            installationId: "primary",
            originalId: original.id,
            version: ids.length,
            fileName: "synthetic.txt",
            format: "txt",
            byteSize: 1,
            contentHash: "a".repeat(64),
            storageKey: `${id}.bin`,
            knowledgeTypes: ["unknown"],
            domainTags: [],
            extraction: {
              format: "txt",
              codePoints,
              segments: [],
              privateCanary: canary,
            },
          },
        });
      }
      const history = () =>
        db.$queryRaw`SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name`;
      const beforeHistory = await history(),
        beforeRows = await db.fileVersion.findMany({ orderBy: { id: "asc" } });
      const run = () =>
        spawnSync(process.execPath, ["deployment/migrate.mjs"], {
          cwd: "/workspace",
          env: process.env,
          encoding: "utf8",
          timeout: 60000,
        });
      const blocked = run(),
        diagnostic = `${blocked.stdout}\n${blocked.stderr}`;
      assert.equal(blocked.status, 1);
      assert.equal(
        diagnostic.includes("TOWNBASE_FILE_EXTRACTION_PREFLIGHT_FAILED"),
        true,
      );
      assert.equal(diagnostic.includes("incompatible_count=2"), true);
      assert.ok(ids.every((id) => diagnostic.includes(id)));
      assert.equal(diagnostic.includes(canary), false);
      assert.equal(diagnostic.includes(url.password), false);
      assert.equal(diagnostic.includes(process.env.DATABASE_URL), false);
      assert.equal(
        JSON.stringify(await history()) === JSON.stringify(beforeHistory),
        true,
        "Migration CLI must not run or leave a failed migration row",
      );
      assert.equal(
        JSON.stringify(
          await db.fileVersion.findMany({ orderBy: { id: "asc" } }),
        ) === JSON.stringify(beforeRows),
        true,
        "Preflight must not change incompatible data",
      );
      // Operator repair is simulated only in this isolated synthetic DB. The product
      // never converts/discards these rows automatically.
      for (const id of ids)
        await db.fileVersion.update({
          where: { id },
          data: {
            extraction: {
              format: "txt",
              codePoints: 1,
              segments: [
                {
                  text: "x",
                  headingPath: [],
                  location: { lineStart: 1, lineEnd: 1 },
                },
              ],
            },
          },
        });
      const stable = () =>
        db.fileVersion.findMany({
          select: {
            id: true,
            originalId: true,
            version: true,
            contentHash: true,
            storageKey: true,
            byteSize: true,
          },
          orderBy: { id: "asc" },
        });
      const stableBefore = await stable();
      const upgraded = run();
      assert.equal(
        upgraded.status,
        0,
        "Compatible upgrade must complete without a retained inspection lock",
      );
      assert.equal(
        JSON.stringify(await stable()) === JSON.stringify(stableBefore),
        true,
      );
      const applied =
        await db.$queryRaw`SELECT count(*)::integer AS count FROM "_prisma_migrations" WHERE migration_name='20261028010000_file_extraction_contract' AND finished_at IS NOT NULL`;
      assert.equal(applied[0].count, 1);
      await assert.rejects(
        db.fileVersion.update({
          where: { id: ids[0] },
          data: { extraction: { format: "txt", codePoints: 1, segments: [] } },
        }),
      );
      await checkFileExtractionUpgrade(db);
      assert.equal(await db.modelCall.count(), 0);
    } finally {
      await db.$disconnect();
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  },
);
