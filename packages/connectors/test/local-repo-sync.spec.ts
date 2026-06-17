import type { DocumentStatus } from "../src/classification";
import {
  normalizeLocalRepoSyncSummary,
  syncLocalRepoFiles,
  type LocalRepoSyncStore,
} from "../src";

describe("syncLocalRepoFiles", () => {
  it("skips unchanged files, updates newer files, and inserts new files", async () => {
    const upserts: Array<{ externalId: string; status: DocumentStatus }> = [];
    const store: LocalRepoSyncStore & {
      documents: Map<string, { externalUpdatedAt: Date | null; status: DocumentStatus }>;
    } = {
      documents: new Map<string, { externalUpdatedAt: Date | null; status: DocumentStatus }>([
        [
          "repo-a:README.md",
          {
            externalUpdatedAt: new Date("2024-01-03T00:00:00.000Z"),
            status: "active",
          },
        ],
        [
          "repo-a:docs/guide.md",
          {
            externalUpdatedAt: new Date("2024-01-01T00:00:00.000Z"),
            status: "active",
          },
        ],
      ]),
      async findDocumentByExternalId(externalId: string) {
        return this.documents.get(externalId) ?? null;
      },
      async upsertDocument(input) {
        upserts.push({ externalId: input.externalId, status: input.status });
        this.documents.set(input.externalId, {
          externalUpdatedAt: input.externalUpdatedAt,
          status: input.status,
        });
      },
      async markLastSyncedAt() {
        return undefined;
      },
    };

    const result = await syncLocalRepoFiles(
      {
        workspaceId: "workspace-1",
        dataSourceId: "source-1",
        syncedAt: new Date("2024-01-10T00:00:00.000Z"),
        files: [
          {
            repoName: "repo-a",
            filePath: "README.md",
            content: "# Repo A\n",
            createdAt: new Date("2024-01-01T00:00:00.000Z"),
            modifiedAt: new Date("2024-01-03T00:00:00.000Z"),
          },
          {
            repoName: "repo-a",
            filePath: "docs/guide.md",
            content: "# Guide v2\n",
            createdAt: new Date("2024-01-01T00:00:00.000Z"),
            modifiedAt: new Date("2024-01-05T00:00:00.000Z"),
          },
          {
            repoName: "repo-a",
            filePath: "prd/payment-flow.md",
            content: "# Payment flow\n",
            createdAt: new Date("2024-01-01T00:00:00.000Z"),
            modifiedAt: new Date("2024-01-07T00:00:00.000Z"),
          },
        ],
      },
      store,
    );

    expect(result).toEqual({
      inserted: 1,
      updated: 1,
      archived: 0,
      skippedUnchanged: 1,
      failed: 0,
      failures: [],
    });
    expect(upserts).toEqual([
      {
        externalId: "repo-a:docs/guide.md",
        status: "active",
      },
      {
        externalId: "repo-a:prd/payment-flow.md",
        status: "active",
      },
    ]);
  });

  it("normalizes the local repo summary to the Phase5 connector contract", async () => {
    const summary = {
      inserted: 2,
      updated: 1,
      archived: 0,
      skippedUnchanged: 3,
      failed: 1,
      failures: [
        {
          repoName: "repo-a",
          filePath: "docs/missing.md",
          reason: "read failed",
        },
      ],
    };

    expect(normalizeLocalRepoSyncSummary(summary)).toEqual({
      created: 2,
      updated: 1,
      skipped: 3,
      failed: 1,
      archived: 0,
      failures: [
        {
          sourceId: "repo-a:docs/missing.md",
          reason: "read failed",
        },
      ],
      index: {
        boundary: "phase6_chunking_deferred",
      },
    });
  });
});
