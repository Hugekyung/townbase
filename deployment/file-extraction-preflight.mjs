import { readFile } from "node:fs/promises";

const migration = new URL(
  "../packages/database/prisma/migrations/20261028010000_file_extraction_contract/migration.sql",
  import.meta.url,
);

// Reuse the exact shipped CHECK, not a second handwritten JSON contract.
export async function fileExtractionPredicate() {
  const source = await readFile(migration, "utf8");
  const start = 'ADD CONSTRAINT "FileVersion_extraction_check" CHECK (\n';
  const end = "\n);\nCREATE INDEX";
  const from = source.indexOf(start),
    to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0 || source.indexOf(start, from + 1) >= 0)
    throw new Error("File extraction migration contract unavailable");
  return source.slice(from + start.length, to);
}

// Must use an autocommit inspection connection, not the migration-lock
// transaction: a retained SELECT lock would block the CLI's ALTER TABLE.
export async function checkFileExtractionUpgrade(client) {
  const [table] =
    await client.$queryRaw`SELECT to_regclass('public."FileVersion"') IS NOT NULL AS present`;
  if (!table?.present) return;
  const predicate = await fileExtractionPredicate();
  const [report] = await client.$queryRawUnsafe(`
    WITH incompatible AS NOT MATERIALIZED (
      SELECT "id" FROM public."FileVersion" WHERE (${predicate}) IS NOT TRUE
    ), sample AS (SELECT "id" FROM incompatible ORDER BY "id" LIMIT 20)
    SELECT (SELECT count(*)::text FROM incompatible) AS count,
      COALESCE((SELECT json_agg("id"::text ORDER BY "id") FROM sample), '[]'::json) AS ids`);
  if (report?.count === "0") return;
  if (
    !/^[1-9][0-9]*$/.test(report?.count ?? "") ||
    !Array.isArray(report?.ids) ||
    report.ids.length === 0 ||
    report.ids.length > 20 ||
    !report.ids.every(
      (id) =>
        typeof id === "string" &&
        /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id),
    )
  )
    throw new Error("File extraction preflight report unavailable");
  throw Object.assign(new Error("Incompatible file extraction records"), {
    code: "TOWNBASE_FILE_EXTRACTION_PREFLIGHT_FAILED",
    incompatibleCount: report.count,
    versionIds: report.ids,
  });
}
