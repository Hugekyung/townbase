import assert from "node:assert/strict";

// Read only: reject even an empty migration-history table or partial schema.
// This runs before any fixture, filesystem setup, or migration CLI invocation.
export async function assertFreshPreflightDatabase(db) {
  const [state] = await db.$queryRaw`
    SELECT NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
    ) AS empty`;
  assert.equal(
    state?.empty,
    true,
    "Fresh dedicated preflight DB required; existing relations or migration history must not be reset implicitly",
  );
}
