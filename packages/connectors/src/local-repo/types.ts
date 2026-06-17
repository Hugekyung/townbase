import type { DocumentStatus, KnowledgeType, SourceType } from "../classification";
import type { DocumentIndexStatus } from "../document-state";

export type LocalRepoFileSnapshot = Readonly<{
  repoName: string;
  filePath: string;
  content: string;
  createdAt: Date;
  modifiedAt: Date;
}>;

export type LocalRepoDocumentDraft = Readonly<{
  workspaceId: string;
  dataSourceId: string;
  externalId: string;
  sourceType: SourceType;
  title: string;
  url: string | null;
  filePath: string;
  repoName: string;
  content: string;
  contentHash: string;
  indexStatus: DocumentIndexStatus;
  status: DocumentStatus;
  knowledgeTypes: ReadonlyArray<KnowledgeType>;
  domainTags: ReadonlyArray<string>;
  externalCreatedAt: Date | null;
  externalUpdatedAt: Date;
  metadata: Readonly<{
    classifierVersion: string;
    matchedRules: ReadonlyArray<string>;
    filePath: string;
    repoName: string;
    modifiedAt: string;
  }>;
}>;

export type LocalRepoSyncInput = Readonly<{
  workspaceId: string;
  dataSourceId: string;
  syncedAt: Date;
  files: ReadonlyArray<LocalRepoFileSnapshot>;
}>;

export type LocalRepoSyncFailure = Readonly<{
  repoName: string;
  filePath: string;
  reason: string;
}>;

export type LocalRepoSyncSummary = Readonly<{
  inserted: number;
  updated: number;
  archived: number;
  skippedUnchanged: number;
  failed: number;
  failures: ReadonlyArray<LocalRepoSyncFailure>;
}>;

export type LocalRepoSyncStore = Readonly<{
  findDocumentByExternalId: (
    externalId: string,
  ) => Promise<{
    externalUpdatedAt: Date | null;
    contentHash: string | null;
    status: DocumentStatus;
    indexStatus: DocumentIndexStatus;
  } | null>;
  upsertDocument: (input: LocalRepoDocumentDraft) => Promise<void>;
  markLastSyncedAt: (syncedAt: Date) => Promise<void>;
}>;
