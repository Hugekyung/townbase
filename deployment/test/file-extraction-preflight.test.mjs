import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import {
  checkFileExtractionUpgrade,
  fileExtractionPredicate,
} from "../file-extraction-preflight.mjs";

function client(present, report) {
  return {
    sql: [],
    async $queryRaw(strings, ...values) {
      this.sql.push({ kind: "tagged", text: strings.join("?"), values });
      return [{ present }];
    },
    async $queryRawUnsafe(sql) {
      this.sql.push({ kind: "unsafe", text: sql });
      return [report];
    },
  };
}
test("fresh installation without FileVersion needs no data query", async () => {
  const db = client(false);
  await checkFileExtractionUpgrade(db);
  assert.equal(db.sql.length, 1);
  assert.equal(db.sql[0].kind, "tagged");
  assert.equal(
    db.sql[0].text,
    `SELECT to_regclass('public."FileVersion"') IS NOT NULL AS present`,
  );
  assert.deepEqual(db.sql[0].values, []);
});
test("compatible existing files pass inspection with the exact shipped CHECK", async () => {
  const db = client(true, { count: "0", ids: [] });
  await checkFileExtractionUpgrade(db);
  const predicate = await fileExtractionPredicate();
  assert.ok(db.sql[1].text.includes(`WHERE (${predicate}) IS NOT TRUE`));
  const migration = await readFile(
    new URL(
      "../../packages/database/prisma/migrations/20261028010000_file_extraction_contract/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.ok(migration.includes(`CHECK (\n${predicate}\n);`));
  assert.equal(db.sql.length, 2);
  assert.match(db.sql[1].text, /LIMIT 20/);
  assert.match(db.sql[1].text, /AS NOT MATERIALIZED/);
  assert.doesNotMatch(
    db.sql[1].text,
    /SELECT \*|fileName|contentHash|SELECT "extraction"/,
  );
});
test("incompatible rows fail closed with a count and bounded UUID diagnostics only", async () => {
  const ids = ["11111111-1111-4111-8111-111111111111"];
  const db = client(true, { count: "42", ids });
  await assert.rejects(checkFileExtractionUpgrade(db), (error) => {
    assert.equal(error.code, "TOWNBASE_FILE_EXTRACTION_PREFLIGHT_FAILED");
    assert.equal(error.incompatibleCount, "42");
    assert.deepEqual(error.versionIds, ids);
    assert.equal(error.message, "Incompatible file extraction records");
    return true;
  });
});
test("missing or malformed reports never become success or expose raw diagnostics", async () => {
  for (const report of [
    undefined,
    { count: "1", ids: [] },
    { count: "private text", ids: [] },
    { count: "1", ids: ["private document content"] },
    { count: "1", ids: Array(21).fill("11111111-1111-4111-8111-111111111111") },
  ]) {
    await assert.rejects(
      checkFileExtractionUpgrade(client(true, report)),
      (error) => {
        assert.equal(
          error.message,
          "File extraction preflight report unavailable",
        );
        return true;
      },
    );
  }
});

// The guard itself is read-only, including malformed/missing result handling.
import { assertFreshPreflightDatabase } from "./file-extraction-preflight-guard.mjs";
test("fresh test DB guard permits only an explicitly empty public schema", async () => {
  let queries = 0;
  await assertFreshPreflightDatabase({
    async $queryRaw(strings) {
      queries++;
      assert.match(strings.join(""), /pg_class/);
      assert.match(strings.join(""), /relkind IN/);
      return [{ empty: true }];
    },
  });
  assert.equal(queries, 1);
});
test("fresh test DB guard rejects existing or unknown schema state", async () => {
  for (const rows of [[{ empty: false }], [], [{}]]) {
    await assert.rejects(
      assertFreshPreflightDatabase({
        async $queryRaw() {
          return rows;
        },
      }),
      /Fresh dedicated preflight DB required/,
    );
  }
});
