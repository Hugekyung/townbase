import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, after, test } from "node:test";
import { configureRuntimeRole } from "../runtime-role.mjs";

// Explicit opt-in, disposable DB only. This file is excluded from *.test.mjs.
const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/invalid");
assert.equal(url.hostname, "postgres");
assert.match(url.pathname, /^\/townbase_pr34_[a-z0-9_]+_test$/);
const requireDatabase = createRequire(
  new URL("../../packages/database/package.json", import.meta.url),
);
const { PrismaClient } = requireDatabase("./dist/index.js");
const db = new PrismaClient();

async function configure() {
  await db.$transaction((tx) => configureRuntimeRole(tx), { timeout: 30000 });
}

async function reset() {
  await db.$executeRaw`REVOKE ALL ON TABLE "_ReviewAclProbe" FROM PUBLIC`;
  await db.$executeRaw`REVOKE SELECT (id) ON TABLE "_ReviewAclProbe" FROM PUBLIC`;
  await db.$executeRaw`REVOKE ALL ON SEQUENCE "_ReviewAclSequence" FROM PUBLIC`;
  for (const schema of ["", "IN SCHEMA public"]) {
    for (const kind of ["TABLES", "SEQUENCES"]) {
      // All fragments are constants; no configuration or secrets enter SQL.
      await db.$executeRawUnsafe(
        `ALTER DEFAULT PRIVILEGES ${schema} REVOKE ALL ON ${kind} FROM PUBLIC, townbase_runtime`,
      );
    }
  }
}

before(async () => {
  await configure();
  await db.$executeRaw`CREATE TABLE "_ReviewAclProbe" (id integer)`;
  await db.$executeRaw`CREATE SEQUENCE "_ReviewAclSequence"`;
});
after(async () => {
  try {
    await reset();
    await db.$executeRaw`DROP TABLE "_ReviewAclProbe"`;
    await db.$executeRaw`DROP SEQUENCE "_ReviewAclSequence"`;
  } finally {
    await db.$disconnect();
  }
});

test("clean DB can be reconfigured without granting unrelated table reads", async () => {
  await configure();
  const [row] =
    await db.$queryRaw`SELECT has_table_privilege('townbase_runtime', '"_ReviewAclProbe"', 'SELECT') AS readable`;
  assert.equal(row.readable, false);
});

for (const [name, sql] of [
  ["PUBLIC table grant", 'GRANT SELECT ON "_ReviewAclProbe" TO PUBLIC'],
  ["PUBLIC column grant", 'GRANT SELECT (id) ON "_ReviewAclProbe" TO PUBLIC'],
  [
    "PUBLIC sequence grant",
    'GRANT USAGE ON SEQUENCE "_ReviewAclSequence" TO PUBLIC',
  ],
  [
    "owner global PUBLIC defaults",
    "ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO PUBLIC",
  ],
  [
    "owner global runtime defaults",
    "ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO townbase_runtime",
  ],
  [
    "owner schema PUBLIC defaults",
    "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO PUBLIC",
  ],
  [
    "owner schema runtime sequence defaults",
    "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO townbase_runtime",
  ],
]) {
  test(`refuses ${name}, preserves its ACL, then recovers after explicit cleanup`, async () => {
    await reset();
    await db.$executeRawUnsafe(sql);
    const aclBefore =
      await db.$queryRaw`SELECT relname, relacl::text AS acl FROM pg_class WHERE relname IN ('_ReviewAclProbe', '_ReviewAclSequence') ORDER BY relname`;
    const defaultsBefore =
      await db.$queryRaw`SELECT oid::text, defaclacl::text AS acl FROM pg_default_acl ORDER BY oid`;
    await assert.rejects(configure(), {
      code: "TOWNBASE_UNSAFE_RUNTIME_GRANTS",
    });
    assert.deepEqual(
      await db.$queryRaw`SELECT relname, relacl::text AS acl FROM pg_class WHERE relname IN ('_ReviewAclProbe', '_ReviewAclSequence') ORDER BY relname`,
      aclBefore,
    );
    assert.deepEqual(
      await db.$queryRaw`SELECT oid::text, defaclacl::text AS acl FROM pg_default_acl ORDER BY oid`,
      defaultsBefore,
    );
    await reset();
    await configure();
  });
}
