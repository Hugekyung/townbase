export type SyncSource = "notion" | "local_repo";

export type PhaseBoundaryStatus = "deferred_phase6";

export type SyncSummaryCounts = Readonly<{
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  archived: number;
}>;

export type SyncFailure = Readonly<{
  pageId?: string;
  pageTitle?: string;
  reason: string;
}>;

export type SyncScope = Readonly<{
  repoNames?: readonly string[];
  fixturePath?: string;
}>;

export type SyncResponse = Readonly<{
  source: SyncSource;
  scope: SyncScope;
  summary: SyncSummaryCounts;
  observability: Readonly<{
    archived: Readonly<{
      documents: number;
    }>;
    index: Readonly<{
      status: PhaseBoundaryStatus;
      failed: number;
    }>;
    chunking: Readonly<{
      status: PhaseBoundaryStatus;
    }>;
  }>;
  failures?: readonly SyncFailure[];
}>;

export type ConnectorSyncFailure = Readonly<{
  pageId?: string;
  pageTitle?: string;
  reason: string;
}>;

export type ConnectorSyncSummary = Readonly<{
  inserted: number;
  updated: number;
  archived: number;
  skippedUnchanged: number;
  failed?: number;
  failures?: readonly ConnectorSyncFailure[];
}>;

export type RunNotionSyncRequest = Readonly<{
  fixturePath?: string;
}>;

export type RunRepoSyncRequest = Readonly<{
  repoNames: readonly string[];
}>;
