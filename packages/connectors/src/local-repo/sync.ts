import { mapLocalRepoFileToDocumentDraft } from "./mapping";
import type { LocalRepoSyncInput, LocalRepoSyncStore, LocalRepoSyncSummary } from "./types";

const compareModifiedAt = (left: Date | null, right: Date | null): number => {
  if (left === null || right === null) {
    return Number.NaN;
  }

  return left.getTime() - right.getTime();
};

const shouldSkipStaleDocument = (
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

export const syncLocalRepoFiles = async (
  input: LocalRepoSyncInput,
  store: LocalRepoSyncStore,
): Promise<LocalRepoSyncSummary> => {
  let inserted = 0;
  let updated = 0;
  let archived = 0;
  let skippedUnchanged = 0;

  for (const file of input.files) {
    const existing = await store.findDocumentByExternalId(`${file.repoName}:${file.filePath}`);
    const draft = mapLocalRepoFileToDocumentDraft({
      workspaceId: input.workspaceId,
      dataSourceId: input.dataSourceId,
      file,
    });

    if (draft.status === "archived") {
      if (existing !== null && existing.status === "archived") {
        if (shouldSkipStaleDocument(existing, draft.externalUpdatedAt)) {
          skippedUnchanged += 1;
          continue;
        }
      }

      await store.upsertDocument(draft);
      archived += 1;
      continue;
    }

    if (existing !== null) {
      if (existing.status === draft.status && shouldSkipStaleDocument(existing, draft.externalUpdatedAt)) {
        skippedUnchanged += 1;
        continue;
      }

      if (existing.contentHash === null && shouldSkipStaleDocument(existing, draft.externalUpdatedAt)) {
        skippedUnchanged += 1;
        continue;
      }

      await upsertDraft(store, input, file);
      updated += 1;
      continue;
    }

    await upsertDraft(store, input, file);
    inserted += 1;
  }

  await store.markLastSyncedAt(input.syncedAt);

  return {
    inserted,
    updated,
    archived,
    skippedUnchanged,
    failed: 0,
    failures: [],
  };
};
