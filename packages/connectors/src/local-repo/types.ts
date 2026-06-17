import type { DocumentStatus, KnowledgeType, SourceType } from "../classification";

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

export type LocalRepoSyncSummary = Readonly<{
  inserted: number;
  updated: number;
  archived: number;
  skippedUnchanged: number;
}>;

export type LocalRepoSyncStore = Readonly<{
  findDocumentByExternalId: (
    externalId: string,
  ) => Promise<{
    externalUpdatedAt: Date | null;
    status: DocumentStatus;
  } | null>;
  upsertDocument: (input: LocalRepoDocumentDraft) => Promise<void>;
  markLastSyncedAt: (syncedAt: Date) => Promise<void>;
}>;
