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
  await db.$executeRaw`REVOKE SELECT (id) ON public."Installation" FROM townbase_runtime`;
  await db.$executeRaw`REVOKE ALL ON ALL TABLES IN SCHEMA "_ReviewShared" FROM PUBLIC, townbase_runtime`;
  await db.$executeRaw`REVOKE SELECT (id) ON "_ReviewShared"."Installation" FROM PUBLIC, townbase_runtime`;
  await db.$executeRaw`REVOKE ALL ON ALL SEQUENCES IN SCHEMA "_ReviewShared" FROM PUBLIC, townbase_runtime`;
  await db.$executeRaw`REVOKE ALL ON SCHEMA "_ReviewShared" FROM PUBLIC, townbase_runtime`;
  for (const routine of [
    'public."_ReviewDefiner"()',
    'public."_ReviewInvoker"()',
    'public."_ReviewProcedure"()',
    '"_ReviewShared"."_ReviewDefiner"()',
  ]) {
    await db.$executeRawUnsafe(
      `REVOKE ALL ON ROUTINE ${routine} FROM PUBLIC, townbase_runtime`,
    );
  }
  await db.$executeRaw`ALTER FUNCTION public.vector_dims(public.vector) SECURITY INVOKER`;
  for (const creator of ["", 'FOR ROLE "_ReviewAclCreator"']) {
    for (const schema of [
      "",
      "IN SCHEMA public",
      'IN SCHEMA "_ReviewShared"',
    ]) {
      for (const kind of ["TABLES", "SEQUENCES", "FUNCTIONS"]) {
        // All fragments are constants; no configuration or secrets enter SQL.
        await db.$executeRawUnsafe(
          `ALTER DEFAULT PRIVILEGES ${creator} ${schema} REVOKE ALL ON ${kind} FROM PUBLIC, townbase_runtime`,
        );
      }
    }
    await db.$executeRawUnsafe(
      `ALTER DEFAULT PRIVILEGES ${creator} GRANT EXECUTE ON FUNCTIONS TO PUBLIC`,
    );
    await db.$executeRawUnsafe(
      `ALTER DEFAULT PRIVILEGES ${creator} REVOKE ALL ON SCHEMAS FROM PUBLIC, townbase_runtime`,
    );
  }
}

before(async () => {
  await configure();
  await db.$executeRaw`CREATE TABLE "_ReviewAclProbe" (id integer)`;
  await db.$executeRaw`CREATE SEQUENCE "_ReviewAclSequence"`;
  await db.$executeRaw`CREATE SCHEMA "_ReviewShared"`;
  await db.$executeRaw`CREATE TABLE "_ReviewShared"."Installation" (id integer)`;
  await db.$executeRaw`CREATE SEQUENCE "_ReviewShared"."_ReviewSequence"`;
  await db.$executeRaw`CREATE FUNCTION public."_ReviewDefiner"() RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'SELECT 42'`;
  await db.$executeRaw`CREATE FUNCTION public."_ReviewInvoker"() RETURNS integer LANGUAGE sql SECURITY INVOKER AS 'SELECT 42'`;
  await db.$executeRaw`CREATE PROCEDURE public."_ReviewProcedure"() LANGUAGE plpgsql SECURITY DEFINER AS 'BEGIN NULL; END'`;
  await db.$executeRaw`CREATE FUNCTION "_ReviewShared"."_ReviewDefiner"() RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'SELECT 42'`;
  await db.$executeRaw`CREATE ROLE "_ReviewAclCreator" NOLOGIN`;
  await reset();
});
after(async () => {
  try {
    await reset();
    await db.$executeRaw`DROP TABLE "_ReviewAclProbe"`;
    await db.$executeRaw`DROP SEQUENCE "_ReviewAclSequence"`;
    await db.$executeRaw`DROP SCHEMA "_ReviewShared" CASCADE`;
    await db.$executeRaw`DROP FUNCTION public."_ReviewDefiner"()`;
    await db.$executeRaw`DROP FUNCTION public."_ReviewInvoker"()`;
    await db.$executeRaw`DROP PROCEDURE public."_ReviewProcedure"()`;
    await db.$executeRaw`DROP ROLE "_ReviewAclCreator"`;
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

test("required vector invoker routines and readiness reads remain available", async () => {
  await configure();
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL ROLE townbase_runtime`;
    const [row] =
      await tx.$queryRaw`SELECT public.vector_dims('[1,2,3]'::public.vector) AS dimensions, (SELECT count(*) FROM public."Installation")::int AS installations`;
    assert.equal(row.dimensions, 3);
    assert.equal(typeof row.installations, "number");
  });
});

test("successful setup intentionally removes PUBLIC schema and database DDL rights", async () => {
  await db.$executeRaw`GRANT CREATE ON SCHEMA public TO PUBLIC`;
  const [grant] =
    await db.$queryRaw`SELECT format('GRANT CREATE, TEMPORARY ON DATABASE %I TO PUBLIC', current_database()) AS sql`;
  await db.$executeRawUnsafe(grant.sql);
  await configure();
  const [rights] =
    await db.$queryRaw`SELECT has_schema_privilege('public', 'public', 'CREATE') AS schema_create, has_database_privilege('public', current_database(), 'CREATE,TEMPORARY') AS database_ddl`;
  assert.deepEqual(rights, { schema_create: false, database_ddl: false });
});

test("setup removes direct column delegation while retaining readiness SELECT", async () => {
  await db.$executeRaw`GRANT SELECT (id) ON public."Installation" TO townbase_runtime WITH GRANT OPTION`;
  await configure();
  const [rights] =
    await db.$queryRaw`SELECT has_any_column_privilege('townbase_runtime', 'public."Installation"', 'SELECT WITH GRANT OPTION') AS delegation, has_table_privilege('townbase_runtime', 'public."Installation"', 'SELECT') AS readable`;
  assert.deepEqual(rights, { delegation: false, readable: true });
});

async function snapshot() {
  return {
    relations:
      await db.$queryRaw`SELECT n.nspname, c.relname, c.relacl::text AS acl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public', '_ReviewShared') ORDER BY n.nspname,c.relname`,
    columns:
      await db.$queryRaw`SELECT n.nspname, c.relname, a.attname, a.attacl::text AS acl FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public', '_ReviewShared') AND a.attnum > 0 AND NOT a.attisdropped ORDER BY n.nspname,c.relname,a.attnum`,
    routines:
      await db.$queryRaw`SELECT p.oid::text, p.proacl::text AS acl, p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public', '_ReviewShared') ORDER BY p.oid`,
    schemas:
      await db.$queryRaw`SELECT nspname, nspacl::text AS acl FROM pg_namespace WHERE nspname IN ('public', '_ReviewShared') ORDER BY nspname`,
    defaults:
      await db.$queryRaw`SELECT oid::text, defaclacl::text AS acl FROM pg_default_acl ORDER BY oid`,
  };
}

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
  [
    "other schema USAGE",
    'GRANT USAGE ON SCHEMA "_ReviewShared" TO townbase_runtime',
  ],
  ["other schema CREATE", 'GRANT CREATE ON SCHEMA "_ReviewShared" TO PUBLIC'],
  [
    "same-named readiness table in another schema",
    'GRANT SELECT ON "_ReviewShared"."Installation" TO townbase_runtime',
  ],
  [
    "other schema column grant",
    'GRANT SELECT (id) ON "_ReviewShared"."Installation" TO PUBLIC',
  ],
  [
    "other schema sequence grant",
    'GRANT USAGE ON SEQUENCE "_ReviewShared"."_ReviewSequence" TO townbase_runtime',
  ],
  [
    "PUBLIC definer EXECUTE",
    'GRANT EXECUTE ON FUNCTION public."_ReviewDefiner"() TO PUBLIC',
  ],
  [
    "runtime definer EXECUTE",
    'GRANT EXECUTE ON FUNCTION public."_ReviewDefiner"() TO townbase_runtime',
  ],
  [
    "custom invoker EXECUTE",
    'GRANT EXECUTE ON FUNCTION public."_ReviewInvoker"() TO PUBLIC',
  ],
  [
    "procedure EXECUTE",
    'GRANT EXECUTE ON PROCEDURE public."_ReviewProcedure"() TO townbase_runtime',
  ],
  [
    "other schema definer EXECUTE",
    'GRANT EXECUTE ON FUNCTION "_ReviewShared"."_ReviewDefiner"() TO townbase_runtime',
  ],
  [
    "other schema table defaults",
    'ALTER DEFAULT PRIVILEGES IN SCHEMA "_ReviewShared" GRANT SELECT ON TABLES TO PUBLIC',
  ],
  [
    "global function defaults",
    "ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO townbase_runtime",
  ],
  [
    "schema function defaults",
    "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO townbase_runtime",
  ],
  [
    "future schema defaults",
    "ALTER DEFAULT PRIVILEGES GRANT USAGE ON SCHEMAS TO townbase_runtime",
  ],
  [
    "other creator function defaults",
    'ALTER DEFAULT PRIVILEGES FOR ROLE "_ReviewAclCreator" GRANT EXECUTE ON FUNCTIONS TO townbase_runtime',
  ],
  [
    "definer masquerading as vector routine",
    "ALTER FUNCTION public.vector_dims(public.vector) SECURITY DEFINER",
  ],
]) {
  test(`refuses ${name}, preserves its ACL, then recovers after explicit cleanup`, async () => {
    await reset();
    await db.$executeRawUnsafe(sql);
    const before = await snapshot();
    await assert.rejects(configure(), {
      code: "TOWNBASE_UNSAFE_RUNTIME_GRANTS",
    });
    assert.deepEqual(await snapshot(), before);
    await reset();
    await configure();
  });
}

test("B04 grants password/session writes without administrator identity or content access", async () => {
  await configure();
  const [rights] = await db.$queryRaw`SELECT
    has_table_privilege('townbase_runtime', 'public."BootstrapState"', 'SELECT,UPDATE') AS bootstrap,
    has_table_privilege('townbase_runtime', 'public."Administrator"', 'INSERT') AS administrator_insert,
    has_column_privilege('townbase_runtime', 'public."Administrator"', 'passwordHash', 'UPDATE') AS password_change,
    has_column_privilege('townbase_runtime', 'public."AdministratorSession"', 'revokedAt', 'UPDATE') AS session_revoke,
    has_column_privilege('townbase_runtime', 'public."AdministratorSession"', 'lastSeenAt', 'UPDATE') AS session_refresh,
    has_column_privilege('townbase_runtime', 'public."AdministratorSession"', 'expiresAt', 'UPDATE') AS session_extend,
    has_column_privilege('townbase_runtime', 'public."Installation"', 'initializedAt', 'UPDATE') AS initialize,
    has_column_privilege('townbase_runtime', 'public."Installation"', 'name', 'UPDATE') AS rename,
    (has_table_privilege('townbase_runtime', 'public."Administrator"', 'UPDATE,DELETE')
      OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid='public."Administrator"'::regclass AND a.attnum>0 AND NOT a.attisdropped
        AND a.attname NOT IN ('passwordHash','updatedAt') AND has_column_privilege('townbase_runtime', a.attrelid, a.attnum, 'UPDATE'))) AS administrator_mutation,
    (has_table_privilege('townbase_runtime', 'public."Document"', 'SELECT,INSERT,UPDATE,DELETE')
      OR has_any_column_privilege('townbase_runtime', 'public."Document"', 'SELECT,INSERT,UPDATE')) AS content`;
  assert.deepEqual(rights, {
    bootstrap: true,
    administrator_insert: true,
    password_change: true,
    session_revoke: true,
    session_refresh: true,
    session_extend: false,
    initialize: true,
    rename: false,
    administrator_mutation: false,
    content: false,
  });
});

test("B03 refuses PUBLIC updates outside the Installation initialization columns", async () => {
  await db.$executeRaw`GRANT UPDATE (name) ON public."Installation" TO PUBLIC`;
  try {
    await assert.rejects(configure, { code: "TOWNBASE_UNSAFE_RUNTIME_GRANTS" });
  } finally {
    await db.$executeRaw`REVOKE UPDATE (name) ON public."Installation" FROM PUBLIC`;
  }
  await configure();
});

test("B03 strips direct delegation while retaining required setup inserts", async () => {
  await db.$executeRaw`GRANT INSERT ON public."Administrator" TO townbase_runtime WITH GRANT OPTION`;
  await configure();
  const [rights] = await db.$queryRaw`SELECT
    has_table_privilege('townbase_runtime', 'public."Administrator"', 'INSERT') AS insert_allowed,
    has_table_privilege('townbase_runtime', 'public."Administrator"', 'INSERT WITH GRANT OPTION') AS delegation`;
  assert.deepEqual(rights, { insert_allowed: true, delegation: false });
});

for (const [table, privilege, column] of [
  ["Administrator", "UPDATE", "username"],
  ["Administrator", "UPDATE", "id"],
  ["Administrator", "UPDATE", "installationId"],
  ["Administrator", "UPDATE", "disabledAt"],
  ["Administrator", "UPDATE", "createdAt"],
  ["AdministratorSession", "UPDATE", "expiresAt"],
  ["AdministratorSession", "UPDATE", "tokenHash"],
  ["AdministratorSession", "UPDATE", "administratorId"],
  ["AdministratorSession", "UPDATE", "installationId"],
  ["AdministratorSession", "UPDATE", "createdAt"],
  ["ModelCredential", "UPDATE", "installationId"],
  ["ModelCredential", "UPDATE", "purpose"],
  ["ModelCredential", "UPDATE", "createdAt"],
  ["ModelTransferPolicy", "UPDATE", "installationId"],
  ["ModelExecutionSettings", "UPDATE", "installationId"],
  ["ModelCall", "UPDATE", "installationId"],
  ["ModelCall", "UPDATE", "requestId"],
  ["ModelCall", "UPDATE", "ownerAdministratorId"],
  ["ModelCall", "UPDATE", "purpose"],
  ["ModelCall", "UPDATE", "model"],
  ["ModelCall", "UPDATE", "credentialTag"],
  ["ModelCall", "UPDATE", "inputDigest"],
  ["ModelCall", "UPDATE", "configurationDigest"],
  ["ModelCall", "UPDATE", "priceVersion"],
  ["ModelCall", "UPDATE", "reservedNanoUsd"],
  ["ModelCall", "UPDATE", "createdAt"],
  ["ModelCall", "UPDATE", "deadlineAt"],
  ["Document", "SELECT", "id"],
  ["Document", "INSERT", "id"],
  ["Document", "UPDATE", "id"],
]) {
  test(`B03 rejects PUBLIC column ${privilege} on ${table}`, async () => {
    // Constant fixture identifiers only.
    await db.$executeRawUnsafe(
      `GRANT ${privilege} ("${column}") ON public."${table}" TO PUBLIC`,
    );
    try {
      await assert.rejects(configure, {
        code: "TOWNBASE_UNSAFE_RUNTIME_GRANTS",
      });
    } finally {
      await db.$executeRawUnsafe(
        `REVOKE ${privilege} ("${column}") ON public."${table}" FROM PUBLIC`,
      );
    }
    await configure();
  });
}

test("C02 grants only credential/policy writes and no identity mutations or policy deletion", async () => {
  await configure();
  const [rights] = await db.$queryRaw`SELECT
    has_table_privilege('townbase_runtime', 'public."ModelCredential"', 'SELECT') AS credential_read,
    has_table_privilege('townbase_runtime', 'public."ModelCredential"', 'INSERT') AS credential_insert,
    has_table_privilege('townbase_runtime', 'public."ModelCredential"', 'DELETE') AS credential_delete,
    has_table_privilege('townbase_runtime', 'public."ModelCredential"', 'UPDATE') AS credential_table_update,
    has_column_privilege('townbase_runtime', 'public."ModelCredential"', 'ciphertext', 'UPDATE') AS credential_rotate,
    has_column_privilege('townbase_runtime', 'public."ModelCredential"', 'purpose', 'UPDATE') AS credential_rebind,
    has_column_privilege('townbase_runtime', 'public."ModelTransferPolicy"', 'rag', 'UPDATE') AS policy_change,
    has_table_privilege('townbase_runtime', 'public."ModelTransferPolicy"', 'DELETE') AS policy_delete`;
  assert.deepEqual(rights, {
    credential_read: true,
    credential_insert: true,
    credential_delete: true,
    credential_table_update: false,
    credential_rotate: true,
    credential_rebind: false,
    policy_change: true,
    policy_delete: false,
  });
});

test("C02 refuses PUBLIC DELETE on a policy or audit table", async () => {
  for (const table of ["ModelTransferPolicy", "InstallationAuditEvent"]) {
    await db.$executeRawUnsafe(`GRANT DELETE ON public."${table}" TO PUBLIC`);
    try {
      await assert.rejects(configure, {
        code: "TOWNBASE_UNSAFE_RUNTIME_GRANTS",
      });
    } finally {
      await db.$executeRawUnsafe(
        `REVOKE DELETE ON public."${table}" FROM PUBLIC`,
      );
    }
    await configure();
  }
});

test("C01 grants only enumerated execution columns and no call deletion", async () => {
  await configure();
  for (const [table, allowed] of [
    [
      "ModelExecutionSettings",
      [
        "answerModel",
        "reasoning",
        "inputTokenLimit",
        "outputTokenLimit",
        "monthlyBudgetNanoUsd",
        "priceVersion",
        "updatedAt",
      ],
    ],
    [
      "ModelCall",
      [
        "status",
        "chargedNanoUsd",
        "errorCode",
        "usage",
        "providerId",
        "completedAt",
      ],
    ],
  ]) {
    const columns =
      await db.$queryRaw`SELECT a.attname, has_column_privilege('townbase_runtime',c.oid,a.attnum,'UPDATE') AS writable FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname=${table} AND a.attnum>0 AND NOT a.attisdropped`;
    assert.ok(columns.length > allowed.length);
    assert.deepEqual(
      columns
        .filter((c) => c.writable)
        .map((c) => c.attname)
        .sort(),
      [...allowed].sort(),
    );
    const [rights] =
      await db.$queryRaw`SELECT has_table_privilege('townbase_runtime',format('public.%I',${table}),'DELETE,UPDATE,TRUNCATE') AS broad`;
    assert.equal(rights.broad, false);
  }
});

test("C01 refuses PUBLIC deletion of execution settings or calls", async () => {
  for (const table of ["ModelExecutionSettings", "ModelCall"]) {
    await db.$executeRawUnsafe(`GRANT DELETE ON public."${table}" TO PUBLIC`);
    try {
      await assert.rejects(configure, {
        code: "TOWNBASE_UNSAFE_RUNTIME_GRANTS",
      });
    } finally {
      await db.$executeRawUnsafe(
        `REVOKE DELETE ON public."${table}" FROM PUBLIC`,
      );
    }
  }
  await configure();
});

test("D02 file lifecycle allows only cleanup columns and denies every other mutation column", async () => {
  for (const table of ["FileOriginal", "FileVersion", "FileExtractionRun"]) {
    const [access] =
      await db.$queryRaw`SELECT has_table_privilege('townbase_runtime',format('public.%I',${table}),'SELECT') AS readable, has_table_privilege('townbase_runtime',format('public.%I',${table}),'INSERT') AS insertable, has_table_privilege('townbase_runtime',format('public.%I',${table}),'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS forbidden`;
    assert.equal(access.readable, true);
    assert.equal(access.insertable, true);
    assert.equal(access.forbidden, false);
    const columns =
      await db.$queryRaw`SELECT a.attname, has_column_privilege('townbase_runtime',c.oid,a.attnum,'UPDATE') AS writable, has_column_privilege('townbase_runtime',c.oid,a.attnum,'REFERENCES') AS referenceable FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname=${table} AND a.attnum>0 AND NOT a.attisdropped`;
    assert.ok(columns.length > 0);
    assert.ok(
      columns.every(
        (column) =>
          column.writable ===
            {
              FileOriginal: ["deletedAt", "excludedAt", "scopeRevision"],
              FileVersion: ["extraction", "rawDeletedAt"],
              FileExtractionRun: [],
            }[table].includes(column.attname) && column.referenceable === false,
      ),
    );
    await db.$executeRawUnsafe(
      `GRANT UPDATE ("installationId") ON "${table}" TO PUBLIC`,
    );
    try {
      await assert.rejects(configure, {
        code: "TOWNBASE_UNSAFE_RUNTIME_GRANTS",
      });
    } finally {
      await db.$executeRawUnsafe(
        `REVOKE UPDATE ("installationId") ON "${table}" FROM PUBLIC`,
      );
      await configure();
    }
  }
});

test("D01 refuses PUBLIC column REFERENCES on every file table", async () => {
  for (const table of ["FileOriginal", "FileVersion", "FileExtractionRun"]) {
    await db.$executeRawUnsafe(
      `GRANT REFERENCES ("id") ON "${table}" TO PUBLIC`,
    );
    try {
      await assert.rejects(configure, {
        code: "TOWNBASE_UNSAFE_RUNTIME_GRANTS",
      });
    } finally {
      await db.$executeRawUnsafe(
        `REVOKE REFERENCES ("id") ON "${table}" FROM PUBLIC`,
      );
      await configure();
    }
  }
});

test("D03 run storage grants only status/result/cleanup columns and request aliases are immutable", async () => {
  const allowed = [
    "status",
    "errorCode",
    "inputKey",
    "resultOriginalId",
    "resultVersionId",
    "resultExtractionRunId",
    "createdCount",
    "updatedCount",
    "excludedCount",
    "unchangedCount",
    "failedCount",
    "startedAt",
    "completedAt",
  ];
  for (const table of ["FileRun", "FileRunRequest"]) {
    const [rights] =
      await db.$queryRaw`SELECT has_table_privilege('townbase_runtime',format('public.%I',${table}),'SELECT') AS readable, has_table_privilege('townbase_runtime',format('public.%I',${table}),'INSERT') AS insertable, has_table_privilege('townbase_runtime',format('public.%I',${table}),'DELETE') AS deletable, has_table_privilege('townbase_runtime',format('public.%I',${table}),'UPDATE,TRUNCATE,REFERENCES,TRIGGER') AS forbidden`;
    assert.deepEqual(rights, {
      readable: true,
      insertable: true,
      deletable: true,
      forbidden: false,
    });
    const columns =
      await db.$queryRaw`SELECT a.attname, has_column_privilege('townbase_runtime',c.oid,a.attnum,'UPDATE') AS writable, has_column_privilege('townbase_runtime',c.oid,a.attnum,'REFERENCES') AS referenceable FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname=${table} AND a.attnum>0 AND NOT a.attisdropped`;
    assert.ok(columns.length > 0);
    assert.ok(
      columns.every(
        (column) =>
          column.writable ===
            (table === "FileRun" && allowed.includes(column.attname)) &&
          column.referenceable === false,
      ),
    );
  }
});
test("D03 refuses PUBLIC write access to run identity or alias fingerprint", async () => {
  for (const [table, column] of [
    ["FileRun", "ownerAdministratorId"],
    ["FileRunRequest", "fingerprint"],
  ]) {
    await db.$executeRawUnsafe(
      `GRANT UPDATE ("${column}") ON "${table}" TO PUBLIC`,
    );
    try {
      await assert.rejects(configure, {
        code: "TOWNBASE_UNSAFE_RUNTIME_GRANTS",
      });
    } finally {
      await db.$executeRawUnsafe(
        `REVOKE UPDATE ("${column}") ON "${table}" FROM PUBLIC`,
      );
      await configure();
    }
  }
});

test("D04 file indexes allow scoped storage but deny every UPDATE/REFERENCES column", async () => {
  for (const table of ["FileIndex", "FileIndexChunk"]) {
    const [rights] =
      await db.$queryRaw`SELECT has_table_privilege('townbase_runtime',format('public.%I',${table}),'SELECT') AS readable,has_table_privilege('townbase_runtime',format('public.%I',${table}),'INSERT') AS insertable,has_table_privilege('townbase_runtime',format('public.%I',${table}),'DELETE') AS deletable,has_table_privilege('townbase_runtime',format('public.%I',${table}),'UPDATE,TRUNCATE,REFERENCES,TRIGGER') AS forbidden`;
    assert.deepEqual(rights, {
      readable: true,
      insertable: true,
      deletable: true,
      forbidden: false,
    });
    const columns =
      await db.$queryRaw`SELECT a.attname,has_column_privilege('townbase_runtime',c.oid,a.attnum,'UPDATE,REFERENCES') AS writable FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname=${table} AND a.attnum>0 AND NOT a.attisdropped`;
    assert.ok(columns.length > 0);
    assert.ok(columns.every((c) => !c.writable));
  }
});
test("D04 rejects PUBLIC index mutation and reference privileges", async () => {
  for (const [table, column] of [
    ["FileIndex", "versionId"],
    ["FileIndexChunk", "embedding"],
  ]) {
    for (const privilege of ["UPDATE", "REFERENCES"]) {
      await db.$executeRawUnsafe(
        `GRANT ${privilege} ("${column}") ON "${table}" TO PUBLIC`,
      );
      try {
        await assert.rejects(configure, {
          code: "TOWNBASE_UNSAFE_RUNTIME_GRANTS",
        });
      } finally {
        await db.$executeRawUnsafe(
          `REVOKE ${privilege} ("${column}") ON "${table}" FROM PUBLIC`,
        );
        await configure();
      }
    }
  }
});
