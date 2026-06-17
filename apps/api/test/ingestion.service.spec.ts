import { IngestionService } from "../src/ingestion/ingestion.service";
import type { ConnectorSyncRunner } from "../src/ingestion/connector-runner";
import type { ConnectorSyncSummary } from "../src/ingestion/ingestion.types";

const connectorSummary: ConnectorSyncSummary = {
  inserted: 1,
  updated: 2,
  archived: 3,
  skippedUnchanged: 4,
  failed: 1,
  failures: [
    {
      sourceId: "repo-alpha:README.md",
      sourceTitle: "README.md",
      reason: "read failed",
    },
  ],
};

const createService = () => {
  const runner: ConnectorSyncRunner = {
    runRepoSync: jest
      .fn<Promise<ConnectorSyncSummary>, [Readonly<{ repoNames: readonly string[] }>]>()
      .mockResolvedValue(connectorSummary),
    runNotionSync: jest.fn<Promise<ConnectorSyncSummary>, []>().mockResolvedValue(connectorSummary),
  };

  return {
    service: new IngestionService(runner),
    runner,
  };
};

describe("IngestionService", () => {
  it("maps local-repo failure identifiers into the public response contract when syncRepos resolves", async () => {
    const { service, runner } = createService();

    await expect(service.syncRepos(["townbase-docs"])).resolves.toEqual({
      source: "local_repo",
      scope: {
        repoNames: ["townbase-docs"],
      },
      summary: {
        created: 1,
        updated: 2,
        skipped: 4,
        failed: 1,
        archived: 3,
      },
      observability: {
        archived: {
          documents: 3,
        },
        index: {
          status: "deferred_phase6",
          failed: 1,
        },
        chunking: {
          status: "deferred_phase6",
        },
      },
      failures: [
        {
          sourceId: "repo-alpha:README.md",
          sourceTitle: "README.md",
          reason: "read failed",
        },
      ],
    });

    expect(runner.runRepoSync).toHaveBeenCalledWith({
      repoNames: ["townbase-docs"],
    });
  });

  it("maps Notion failure identifiers into the public response contract when syncNotion resolves", async () => {
    const { service, runner } = createService();

    await expect(service.syncNotion()).resolves.toEqual({
      source: "notion",
      scope: {},
      summary: {
        created: 1,
        updated: 2,
        skipped: 4,
        failed: 1,
        archived: 3,
      },
      observability: {
        archived: {
          documents: 3,
        },
        index: {
          status: "deferred_phase6",
          failed: 1,
        },
        chunking: {
          status: "deferred_phase6",
        },
      },
      failures: [
        {
          sourceId: "repo-alpha:README.md",
          sourceTitle: "README.md",
          reason: "read failed",
        },
      ],
    });

    expect(runner.runNotionSync).toHaveBeenCalledWith();
  });
});
