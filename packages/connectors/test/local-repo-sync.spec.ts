import type { DocumentStatus } from "../src/classification";
import { createHash } from "node:crypto";
import {
  normalizeLocalRepoSyncSummary,
  syncLocalRepoFiles,
  type LocalRepoSyncStore,
} from "../src";
import type { DocumentIndexStatus } from "../src/document-state";

describe("syncLocalRepoFiles", () => {
  it("skips unchanged files by freshness, updates changed files, and inserts new files", async () => {
    const upserts: Array<{
      externalId: string;
      status: DocumentStatus;
      contentHash: string;
      indexStatus: string;
    }> = [];
    const readmeHash = createHash("sha256").update("# Repo A\n").digest("hex");
    const guideHash = createHash("sha256").update("# Guide v1\n").digest("hex");
    const store: LocalRepoSyncStore & {
      documents: Map<
        string,
        {
          externalUpdatedAt: Date | null;
          status: DocumentStatus;
          contentHash: string | null;
          indexStatus: DocumentIndexStatus;
        }
      >;
    } = {
      documents: new Map<
        string,
        {
          externalUpdatedAt: Date | null;
          status: DocumentStatus;
          contentHash: string | null;
          indexStatus: DocumentIndexStatus;
        }
      >([
        [
          "repo-a:README.md",
          {
            externalUpdatedAt: new Date("2024-01-01T00:00:00.000Z"),
            status: "active",
            contentHash: readmeHash,
            indexStatus: "pending",
          },
        ],
        [
          "repo-a:docs/guide.md",
          {
            externalUpdatedAt: new Date("2024-01-01T00:00:00.000Z"),
            status: "active",
            contentHash: guideHash,
            indexStatus: "pending",
          },
        ],
      ]),
      async findDocumentByExternalId(externalId: string) {
        return this.documents.get(externalId) ?? null;
      },
      async upsertDocument(input) {
        upserts.push({
          externalId: input.externalId,
          status: input.status,
          contentHash: input.contentHash,
          indexStatus: input.indexStatus,
        });
        this.documents.set(input.externalId, {
          externalUpdatedAt: input.externalUpdatedAt,
          status: input.status,
          contentHash: input.contentHash,
          indexStatus: input.indexStatus,
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
            modifiedAt: new Date("2024-01-01T00:00:00.000Z"),
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
        contentHash: createHash("sha256").update("# Guide v2\n").digest("hex"),
        indexStatus: "pending",
      },
      {
        externalId: "repo-a:prd/payment-flow.md",
        status: "active",
        contentHash: createHash("sha256").update("# Payment flow\n").digest("hex"),
        indexStatus: "pending",
      },
    ]);
  });

  it("does not overwrite a newer archived repo document with an older archived snapshot", async () => {
    let syncedAtCalls = 0;
    const store: LocalRepoSyncStore = {
      async findDocumentByExternalId(externalId: string) {
        if (externalId !== "repo-a:archive/notes.md") {
          return null;
        }

        return {
          externalUpdatedAt: new Date("2024-01-10T00:00:00.000Z"),
          status: "archived",
          contentHash: createHash("sha256").update("# Newer archived notes\n").digest("hex"),
          indexStatus: "pending",
        };
      },
      async upsertDocument() {
        throw new Error("should not upsert archived snapshot");
      },
      async markLastSyncedAt() {
        syncedAtCalls += 1;
        return undefined;
      },
    };

    const result = await syncLocalRepoFiles(
      {
        workspaceId: "workspace-1",
        dataSourceId: "source-1",
        syncedAt: new Date("2024-01-12T00:00:00.000Z"),
        files: [
          {
            repoName: "repo-a",
            filePath: "archive/notes.md",
            content: "# Older archived notes\n",
            createdAt: new Date("2024-01-01T00:00:00.000Z"),
            modifiedAt: new Date("2024-01-05T00:00:00.000Z"),
          },
        ],
      },
      store,
    );

    expect(result).toEqual({
      inserted: 0,
      updated: 0,
      archived: 0,
      skippedUnchanged: 1,
      failed: 0,
      failures: [],
    });
    expect(syncedAtCalls).toBe(1);
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
