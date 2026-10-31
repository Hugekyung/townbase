import { Prisma } from "@townbase/database";
import type { AdministratorContext } from "../auth/auth.service";
import { ModelCallError } from "../model-integration/model-policy";
import { currentIndexWhere } from "./file-index-state";

// Stable source identity copied with a retrieved chunk. Never use title/URL as authority.
export type FileSource = {
  id: string;
  indexId: string;
  originalId: string;
  versionId: string;
  scopeRevision: number;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function assertFileSourcesCurrent(
  tx: Prisma.TransactionClient,
  c: AdministratorContext,
  sources: readonly FileSource[],
): Promise<void> {
  if (
    !Array.isArray(sources) ||
    sources.length === 0 ||
    sources.length > 20 ||
    Array.from(sources).some(
      (s) =>
        s == null ||
        ![s.id, s.indexId, s.originalId, s.versionId].every(
          (id) => typeof id === "string" && uuid.test(id),
        ) ||
        !Number.isSafeInteger(s.scopeRevision) ||
        s.scopeRevision < 1 ||
        s.scopeRevision > 2147483647,
    )
  )
    throw new ModelCallError("invalid_file_sources");
  const unique = new Map(sources.map((s) => [s.id.toLowerCase(), s]));
  if (unique.size !== sources.length)
    throw new ModelCallError("invalid_file_sources");
  const matches = sources.map(
    (s) =>
      Prisma.sql`(ch.id=${s.id}::uuid AND i.id=${s.indexId}::uuid AND i."originalId"=${s.originalId}::uuid AND i."versionId"=${s.versionId}::uuid AND i."scopeRevision"=${s.scopeRevision})`,
  );
  const [row] = await tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT count(*) AS count FROM "FileIndexChunk" ch
    JOIN "FileIndex" i ON i.id=ch."indexId" AND i."installationId"=ch."installationId"
    JOIN "FileVersion" v ON v.id=i."versionId" AND v."installationId"=i."installationId"
    JOIN "FileOriginal" o ON o.id=i."originalId" AND o."installationId"=i."installationId"
    WHERE i."installationId"=${c.installationId} AND i."ownerAdministratorId"=${c.administratorId}
    AND o."ownerAdministratorId"=${c.administratorId} AND ${currentIndexWhere}
    AND (${Prisma.join(matches, " OR ")})`);
  if (row?.count !== BigInt(sources.length))
    throw new ModelCallError("source_changed", 409);
}

export type FileSourceState =
  | "available"
  | "deleted"
  | "replaced"
  | "excluded"
  | "unavailable";
export async function fileSourceReference(
  tx: Prisma.TransactionClient,
  c: AdministratorContext,
  originalId: string,
  versionId: string | null,
  scopeRevision: number | null | undefined,
): Promise<{
  state: FileSourceState;
  resource: string | null;
  reference: string | null;
  sourceDeleted: boolean;
}> {
  const original = await tx.fileOriginal.findFirst({
    where: {
      id: originalId,
      installationId: c.installationId,
      ownerAdministratorId: c.administratorId,
    },
    include: {
      versions: {
        orderBy: { version: "desc" },
        take: 1,
        include: { runs: { orderBy: { ordinal: "desc" }, take: 1 } },
      },
    },
  });
  const version = original?.versions[0];
  let state: FileSourceState;
  if (!original) state = "unavailable";
  else if (original.deletedAt != null) state = "deleted";
  else if (versionId != null && version?.id !== versionId) state = "replaced";
  else if (
    original.excludedAt != null ||
    (scopeRevision != null && original.scopeRevision !== scopeRevision) ||
    (version && version.documentStatus !== "active")
  )
    state = "excluded";
  else if (
    scopeRevision == null ||
    !version ||
    version.rawDeletedAt != null ||
    version.runs[0]?.status !== "extracted"
  )
    state = "unavailable";
  else state = "available";
  return {
    state,
    sourceDeleted: original == null || original.deletedAt != null,
    resource: state === "available" ? `/files/${originalId}` : null,
    reference:
      state === "available"
        ? `/files/${originalId}/reference?versionId=${version!.id}&scopeRevision=${original!.scopeRevision}`
        : null,
  };
}
