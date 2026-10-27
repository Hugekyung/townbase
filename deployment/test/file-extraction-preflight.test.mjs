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
    async $queryRaw() {
      return [{ present }];
    },
    async $queryRawUnsafe(sql) {
      this.sql.push(sql);
      return [report];
    },
  };
}
test("fresh installation without FileVersion needs no data query", async () => {
  const db = client(false);
  await checkFileExtractionUpgrade(db);
  assert.deepEqual(db.sql, []);
});
test("compatible existing files pass inspection with the exact shipped CHECK", async () => {
  const db = client(true, { count: "0", ids: [] });
  await checkFileExtractionUpgrade(db);
  const predicate = await fileExtractionPredicate();
  assert.ok(db.sql[0].includes(`WHERE (${predicate}) IS NOT TRUE`));
  const migration = await readFile(
    new URL(
      "../../packages/database/prisma/migrations/20261028010000_file_extraction_contract/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.ok(migration.includes(`CHECK (\n${predicate}\n);`));
  assert.match(db.sql[0], /LIMIT 20/);
  assert.doesNotMatch(
    db.sql[0],
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
