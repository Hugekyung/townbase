import type { LocalRepoSyncFailure, LocalRepoSyncSummary } from "./local-repo";
import type { NotionSyncFailure, NotionSyncSummary } from "./notion";

export type ConnectorSyncFailure = Readonly<{
  sourceId: string;
  sourceTitle?: string;
  reason: string;
}>;

export type ConnectorIndexBoundary = Readonly<{
  boundary: "phase6_chunking_deferred";
}>;

export type ConnectorSyncSummary = Readonly<{
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  archived: number;
  failures: ReadonlyArray<ConnectorSyncFailure>;
  index: ConnectorIndexBoundary;
}>;

const INDEX_BOUNDARY: ConnectorIndexBoundary = {
  boundary: "phase6_chunking_deferred",
} as const;

const normalizeNotionFailure = (
  failure: NotionSyncFailure,
): ConnectorSyncFailure => ({
  sourceId: failure.pageId,
  ...(failure.pageTitle === undefined ? {} : { sourceTitle: failure.pageTitle }),
  reason: failure.reason,
});

const normalizeLocalRepoFailure = (
  failure: LocalRepoSyncFailure,
): ConnectorSyncFailure => ({
  sourceId: `${failure.repoName}:${failure.filePath}`,
  reason: failure.reason,
});

export const normalizeNotionSyncSummary = (
  summary: NotionSyncSummary,
): ConnectorSyncSummary => ({
  created: summary.inserted,
  updated: summary.updated,
  skipped: summary.skippedUnchanged,
  failed: summary.failed,
  archived: summary.archived,
  failures: summary.failures.map(normalizeNotionFailure),
  index: INDEX_BOUNDARY,
});

export const normalizeLocalRepoSyncSummary = (
  summary: LocalRepoSyncSummary,
): ConnectorSyncSummary => ({
  created: summary.inserted,
  updated: summary.updated,
  skipped: summary.skippedUnchanged,
  failed: summary.failed,
  archived: summary.archived,
  failures: summary.failures.map(normalizeLocalRepoFailure),
  index: INDEX_BOUNDARY,
});
