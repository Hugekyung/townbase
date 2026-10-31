import { Prisma } from "@townbase/database";
import { FILE_INDEX_CONFIGURATION } from "./file-chunker";
export type IndexState = {
  searchable: boolean;
  indexStatus: "indexed" | "stale" | "not_indexed";
  chunkCount: number;
};
// Shared by file UI/API and retrieval. JSON digest is computed by PostgreSQL on both sides.
export const currentFileWhere = Prisma.sql`
  o."deletedAt" IS NULL AND v."rawDeletedAt" IS NULL AND v."documentStatus"='active'
  AND NOT EXISTS (SELECT 1 FROM "FileVersion" newer WHERE newer."installationId"=v."installationId" AND newer."originalId"=v."originalId" AND newer.version>v.version)
  AND (SELECT r.status FROM "FileExtractionRun" r WHERE r."installationId"=v."installationId" AND r."versionId"=v.id ORDER BY r."completedAt" DESC, r.id DESC LIMIT 1)='extracted'`;
export const currentIndexWhere = Prisma.sql`${currentFileWhere}
  AND i."extractionDigest"=encode(sha256(convert_to(v.extraction::text,'UTF8')),'hex')
  AND i."configurationVersion"=${FILE_INDEX_CONFIGURATION} AND i."embeddingModel"='text-embedding-3-small'`;
export async function fileIndexStates(
  tx: Prisma.TransactionClient,
  installation: string,
  ids: string[],
): Promise<Map<string, IndexState>> {
  if (!ids.length) return new Map<string, IndexState>();
  const rows = await tx.$queryRaw<
    Array<{
      id: string;
      indexId: string | null;
      valid: boolean | null;
      chunkCount: number | null;
    }>
  >(Prisma.sql`
    SELECT v.id, i.id AS "indexId", (${currentIndexWhere}) AS valid, i."chunkCount"
    FROM "FileVersion" v JOIN "FileOriginal" o ON o.id=v."originalId" AND o."installationId"=v."installationId"
    LEFT JOIN "FileIndex" i ON i."installationId"=v."installationId" AND i."versionId"=v.id
    WHERE v."installationId"=${installation} AND v.id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})`);
  return new Map<string, IndexState>(
    rows.map((r) => [
      r.id,
      {
        searchable: r.valid === true,
        indexStatus:
          r.valid === true ? "indexed" : r.indexId ? "stale" : "not_indexed",
        chunkCount: r.valid === true ? (r.chunkCount ?? 0) : 0,
      },
    ]),
  );
}
