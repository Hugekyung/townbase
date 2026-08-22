import { mapLocalRepoFileToDocumentDraft } from "./mapping";
import type { DocumentStatus } from "../classification";
import type {
  LocalRepoSyncFailure,
  LocalRepoSyncInput,
  LocalRepoSyncStore,
  LocalRepoSyncSummary,
} from "./types";

const compareModifiedAt = (left: Date | null, right: Date | null): number => {
  if (left === null || right === null) {
    return Number.NaN;
  }

  return left.getTime() - right.getTime();
};

const shouldSkipUnchangedDocument = (
  existing: { readonly contentHash: string | null; readonly status: DocumentStatus },
  draft: { readonly contentHash: string; readonly status: DocumentStatus },
): boolean => existing.status === draft.status && existing.contentHash === draft.contentHash;

const shouldSkipStaleArchivedDocument = (
  existing: { readonly externalUpdatedAt: Date | null },
  draftModifiedAt: Date,
): boolean => existing.externalUpdatedAt !== null && compareModifiedAt(existing.externalUpdatedAt, draftModifiedAt) >= 0;

const upsertDraft = async (
  store: LocalRepoSyncStore,
  input: LocalRepoSyncInput,
  file: LocalRepoSyncInput["files"][number],
): Promise<void> => {
  await store.upsertDocument(
    mapLocalRepoFileToDocumentDraft({
      workspaceId: input.workspaceId,
      dataSourceId: input.dataSourceId,
      file,
    }),
  );
};

const toFailureReason = (error: unknown): string =>
  error instanceof Error ? error.message : "Unknown sync failure";

export const syncLocalRepoFiles = async (
  input: LocalRepoSyncInput,
  store: LocalRepoSyncStore,
): Promise<LocalRepoSyncSummary> => {
  let inserted = 0;
  let updated = 0;
  let archived = 0;
  let skippedUnchanged = 0;
  let failed = 0;
  const failures: LocalRepoSyncFailure[] = [];

  for (const file of input.files) {
    const existing = await store.findDocumentByExternalId(`${file.repoName}:${file.filePath}`);
    const draft = mapLocalRepoFileToDocumentDraft({
      workspaceId: input.workspaceId,
      dataSourceId: input.dataSourceId,
      file,
    });

    if (draft.status === "archived") {
      if (existing !== null && existing.status === "archived") {
        if (shouldSkipStaleArchivedDocument(existing, draft.externalUpdatedAt)) {
          skippedUnchanged += 1;
          continue;
        }
      }

      try {
        await store.upsertDocument(draft);
      } catch (error: unknown) {
        failed += 1;
        failures.push({
          repoName: file.repoName,
          filePath: file.filePath,
          reason: toFailureReason(error),
        });
        continue;
      }
      archived += 1;
      continue;
    }

    if (existing !== null) {
      if (shouldSkipUnchangedDocument(existing, draft)) {
        skippedUnchanged += 1;
        continue;
      }

      try {
        await upsertDraft(store, input, file);
      } catch (error: unknown) {
        failed += 1;
        failures.push({
          repoName: file.repoName,
          filePath: file.filePath,
          reason: toFailureReason(error),
        });
        continue;
      }
      updated += 1;
      continue;
    }

    try {
      await upsertDraft(store, input, file);
    } catch (error: unknown) {
      failed += 1;
      failures.push({
        repoName: file.repoName,
        filePath: file.filePath,
        reason: toFailureReason(error),
      });
      continue;
    }
    inserted += 1;
  }

  const seenExternalIds = input.files.map((file) => `${file.repoName}:${file.filePath}`);
  archived += await store.archiveMissingDocuments(input.selectedRepoNames, seenExternalIds);

  await store.markLastSyncedAt(input.syncedAt);

  return {
    inserted,
    updated,
    archived,
    skippedUnchanged,
    failed,
    failures,
  };
};
