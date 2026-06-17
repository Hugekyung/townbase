import { Inject, Injectable } from "@nestjs/common";

import {
  CONNECTOR_SYNC_RUNNER,
  type ConnectorSyncRunner,
} from "./connector-runner";
import type {
  ConnectorSyncSummary,
  SyncFailure,
  SyncResponse,
  SyncSource,
} from "./ingestion.types";

const toFailures = (
  summary: ConnectorSyncSummary,
): readonly SyncFailure[] | undefined =>
  summary.failures?.map((failure) => ({
    ...(failure.pageId === undefined ? {} : { pageId: failure.pageId }),
    ...(failure.pageTitle === undefined ? {} : { pageTitle: failure.pageTitle }),
    reason: failure.reason,
  }));

const buildResponse = (
  source: SyncSource,
  summary: ConnectorSyncSummary,
  scope: SyncResponse["scope"],
): SyncResponse => {
  const failed = summary.failed ?? 0;
  const failures = toFailures(summary);

  return {
    source,
    scope,
    summary: {
      created: summary.inserted,
      updated: summary.updated,
      skipped: summary.skippedUnchanged,
      failed,
      archived: summary.archived,
    },
    observability: {
      archived: {
        documents: summary.archived,
      },
      index: {
        status: "deferred_phase6",
        failed,
      },
      chunking: {
        status: "deferred_phase6",
      },
    },
    ...(failures === undefined ? {} : { failures }),
  };
};

@Injectable()
export class IngestionService {
  public constructor(
    @Inject(CONNECTOR_SYNC_RUNNER)
    private readonly connectorRunner: ConnectorSyncRunner,
  ) {}

  public async syncRepos(repoNames: readonly string[]): Promise<SyncResponse> {
    const summary = await this.connectorRunner.runRepoSync({ repoNames });

    return buildResponse("local_repo", summary, { repoNames });
  }

  public async syncNotion(): Promise<SyncResponse> {
    const summary = await this.connectorRunner.runNotionSync();

    return buildResponse("notion", summary, {});
  }
}
