import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

// Explicit disposable DB. This is excluded from ordinary *.test.mjs runs.
assert.equal(process.env.TOWNBASE_FILE_INDEX_UPGRADE_TEST, "1");
const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/invalid");
assert.equal(url.hostname, "postgres");
assert.equal(url.pathname, "/townbase_d04_pr44_upgrade_test");
const require = createRequire(
  new URL("../../packages/database/package.json", import.meta.url),
);
const { PrismaClient } = require("./dist/index.js");
const db = new PrismaClient();
test("D04 follow-up preserves legacy history, fails closed on timestamp ties, and bounds chunk configuration", async () => {
  try {
    const rows =
      await db.$queryRaw`SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S')`;
    assert.equal(rows.length, 0, "Fresh isolated DB required; refuse reset");
    // Minimal old tables isolate the ALTER/backfill contract from application fixtures.
    await db.$executeRaw`CREATE TABLE "FileExtractionRun" (id UUID PRIMARY KEY,"installationId" TEXT NOT NULL,"versionId" UUID NOT NULL,status TEXT NOT NULL,"startedAt" TIMESTAMP(3) NOT NULL,"completedAt" TIMESTAMP(3) NOT NULL,"errorCode" TEXT)`;
    await db.$executeRaw`CREATE TABLE "FileIndex" (id UUID PRIMARY KEY,"configurationVersion" TEXT NOT NULL CONSTRAINT "FileIndex_configurationVersion_check" CHECK ("configurationVersion"='file-index-d04-v1'), preserved JSONB)`;
    const version = "11111111-1111-4111-8111-111111111111";
    // UUID order opposes the desired conservative ordering for ambiguous history.
    await db.$executeRaw`INSERT INTO "FileExtractionRun" VALUES ('00000000-0000-4000-8000-000000000001','fixture',${version}::uuid,'failed','2026-10-31','2026-10-31','parser_failed'),('ffffffff-ffff-4fff-8fff-ffffffffffff','fixture',${version}::uuid,'extracted','2026-10-31','2026-10-31',NULL)`;
    await db.$executeRaw`INSERT INTO "FileIndex" VALUES ('11111111-1111-4111-8111-111111111111','file-index-d04-v1','{"preserve":"content"}')`;
    const before =
      await db.$queryRaw`SELECT * FROM "FileExtractionRun" ORDER BY id`;
    const oldIndex = await db.$queryRaw`SELECT * FROM "FileIndex"`;
    const sql = (
      await readFile(
        new URL(
          "../../packages/database/prisma/migrations/20261101010000_file_index_review/migration.sql",
          import.meta.url,
        ),
        "utf8",
      )
    ).replace(/--[^\n]*/g, "");
    await db.$transaction(async (tx) => {
      for (const statement of sql.split(";").filter((s) => s.trim()))
        await tx.$executeRawUnsafe(statement);
    });
    const after =
      await db.$queryRaw`SELECT id,"installationId","versionId",status,"startedAt","completedAt","errorCode",ordinal FROM "FileExtractionRun" ORDER BY id`;
    assert.deepEqual(
      after.map(({ ordinal, ...row }) => row),
      before,
    );
    assert.deepEqual(
      after.map((r) => [r.status, r.ordinal]),
      [
        ["failed", 2],
        ["extracted", 1],
      ],
    );
    assert.deepEqual(
      (
        await db.$queryRaw`SELECT id,"configurationVersion",preserved,"chunkBytes" FROM "FileIndex"`
      ).map(({ chunkBytes, ...row }) => row),
      oldIndex,
    );
    assert.equal(
      (await db.$queryRaw`SELECT "chunkBytes" FROM "FileIndex"`)[0].chunkBytes,
      4096,
    );
    await assert.rejects(db.$executeRaw`UPDATE "FileIndex" SET "chunkBytes"=0`);
    await assert.rejects(
      db.$executeRaw`UPDATE "FileIndex" SET "chunkBytes"=4097`,
    );
    await db.$executeRaw`UPDATE "FileIndex" SET "chunkBytes"=256,"configurationVersion"='file-index-d04-v2'`;
    await assert.rejects(
      db.$executeRaw`UPDATE "FileExtractionRun" SET ordinal=0 WHERE status='failed'`,
    );
    await assert.rejects(
      db.$executeRaw`UPDATE "FileExtractionRun" SET ordinal=1 WHERE status='failed'`,
    );
  } finally {
    // Leave fixture state for inspection; never reset a pre-existing DB.
    await db.$disconnect();
  }
});
