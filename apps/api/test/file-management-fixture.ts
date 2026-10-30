import type { PrismaClient } from "@townbase/database";

type FixtureDatabase = Pick<
  PrismaClient,
  "installation" | "fileOriginal" | "modelCall" | "document" | "documentChunk"
>;
export async function assertFreshFileManagementDatabase(
  db: FixtureDatabase,
): Promise<void> {
  // Workspace may include the migration seed. Every table assumed empty by the
  // suite must be checked before the first fixture write, without cleaning it.
  const counts = await Promise.all([
    db.installation.count(),
    db.fileOriginal.count(),
    db.modelCall.count(),
    db.document.count(),
    db.documentChunk.count(),
  ]);
  if (counts.some((count) => count !== 0))
    throw new Error("Fresh D02 synthetic DB required; refuse reset");
}
