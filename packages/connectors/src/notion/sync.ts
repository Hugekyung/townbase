import {
  mapNotionPageToDocumentDraft,
  type NotionPageDraft,
} from "./mapping";
import type { DocumentIndexStatus } from "../document-state";
import type { DocumentStatus } from "../classification";

type NotionPageInput = Readonly<{
  page: Readonly<{
    id: string;
    title: string;
    url: string;
    createdTime?: string;
    lastEditedTime: string;
  }>;
  content: string;
  pathSegments: ReadonlyArray<string>;
  archived?: boolean;
}>;

export type NotionSyncFailure = Readonly<{
  pageId: string;
  pageTitle?: string;
  reason: string;
}>;

export type NotionSyncSummary = Readonly<{
  inserted: number;
  updated: number;
  archived: number;
  skippedUnchanged: number;
  failed: number;
  failures: ReadonlyArray<NotionSyncFailure>;
}>;

export type NotionSyncStore = Readonly<{
  findDocumentByExternalId: (
    externalId: string,
  ) => Promise<{
    externalUpdatedAt: Date | null;
    contentHash: string | null;
    status: DocumentStatus;
    indexStatus: DocumentIndexStatus;
  } | null>;
  upsertDocument: (input: NotionPageDraft) => Promise<void>;
  markLastSyncedAt: (syncedAt: Date) => Promise<void>;
}>;

export type NotionSyncLogger = Readonly<{
  warn: (entry: NotionSyncFailure) => void;
}>;

export type NotionSyncInput = Readonly<{
  workspaceId: string;
  dataSourceId: string;
  syncedAt: Date;
  pages: ReadonlyArray<NotionPageInput>;
  failures?: ReadonlyArray<NotionSyncFailure>;
}>;

const parseEditedAt = (value: string): Date | null => {
  if (value.trim() === "") {
    return null;
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const compareEditedAt = (
  left: Date | null,
  right: Date | null,
): number => {
  if (left === null || right === null) {
    return Number.NaN;
  }

  return left.getTime() - right.getTime();
};

const shouldSkipStaleDocument = (
  existing: { readonly externalUpdatedAt: Date | null },
  draftEditedAt: Date,
): boolean => existing.externalUpdatedAt !== null && compareEditedAt(existing.externalUpdatedAt, draftEditedAt) >= 0;

const recordFailure = (
  summary: NotionSyncFailure[],
  logger: NotionSyncLogger,
  failure: NotionSyncFailure,
): void => {
  summary.push(failure);
  logger.warn(failure);
};

const upsertDraft = async (
  store: NotionSyncStore,
  draft: NotionPageDraft,
): Promise<void> => {
  await store.upsertDocument(draft);
};

export const syncNotionPages = async (
  input: NotionSyncInput,
  store: NotionSyncStore,
  logger: NotionSyncLogger,
): Promise<NotionSyncSummary> => {
  let inserted = 0;
  let updated = 0;
  let archived = 0;
  let skippedUnchanged = 0;
  let failed = 0;
  const failures: NotionSyncFailure[] = [];

  for (const failure of input.failures ?? []) {
    failed += 1;
    recordFailure(failures, logger, failure);
  }

  for (const pageInput of input.pages) {
    const editedAt = parseEditedAt(pageInput.page.lastEditedTime);

    if (editedAt === null) {
      failed += 1;
      recordFailure(failures, logger, {
        pageId: pageInput.page.id,
        pageTitle: pageInput.page.title,
        reason: "Missing lastEditedTime",
      });
      continue;
    }

    const existing = await store.findDocumentByExternalId(pageInput.page.id);
    const draft = mapNotionPageToDocumentDraft({
      workspaceId: input.workspaceId,
      dataSourceId: input.dataSourceId,
      page: pageInput.page,
      content: pageInput.content,
      pathSegments: pageInput.pathSegments,
      archived: pageInput.archived,
    });

    if (pageInput.archived === true) {
      if (existing !== null && existing.status === "archived") {
        if (shouldSkipStaleDocument(existing, editedAt)) {
          skippedUnchanged += 1;
          continue;
        }
      }

      await upsertDraft(store, draft);
      archived += 1;
      continue;
    }

    if (existing !== null) {
      if (
        existing.status === draft.status &&
        shouldSkipStaleDocument(existing, editedAt)
      ) {
        skippedUnchanged += 1;
        continue;
      }

      await upsertDraft(store, draft);
      updated += 1;
      continue;
    }

    await upsertDraft(store, draft);
    inserted += 1;
  }

  if (failed === 0) {
    await store.markLastSyncedAt(input.syncedAt);
  }

  return {
    inserted,
    updated,
    archived,
    skippedUnchanged,
    failed,
    failures,
  };
};
