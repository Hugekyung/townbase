import { createHash } from "node:crypto";

import {
  normalizeNotionSyncSummary,
  syncNotionPages,
  type NotionSyncStore,
} from "../src";
import type { DocumentStatus } from "../src/classification";
import type { DocumentIndexStatus } from "../src/document-state";

describe("syncNotionPages", () => {
  it("skips unchanged pages by hash, upserts changed pages once, and records failures", async () => {
    const upserts: Array<{
      externalId: string;
      status: string;
      contentHash: string;
      indexStatus: string;
    }> = [];
    const syncedAt = new Date("2024-01-10T00:00:00.000Z");
    const unchangedHash = createHash("sha256").update("old").digest("hex");
    const changedHash = createHash("sha256").update("new content").digest("hex");
    const archivedHash = createHash("sha256").update("archived content").digest("hex");
    const logEntries: Array<{
      pageId: string;
      pageTitle?: string;
      reason: string;
    }> = [];
    const store: NotionSyncStore & {
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
          "unchanged",
          {
            externalUpdatedAt: new Date("2024-01-01T00:00:00.000Z"),
            status: "active",
            contentHash: unchangedHash,
            indexStatus: "pending",
          },
        ],
        [
          "changed",
          {
            externalUpdatedAt: new Date("2024-01-01T00:00:00.000Z"),
            status: "active",
            contentHash: null,
            indexStatus: "pending",
          },
        ],
        [
          "archived",
          {
            externalUpdatedAt: new Date("2024-01-01T00:00:00.000Z"),
            status: "active",
            contentHash: archivedHash,
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

    const result = await syncNotionPages(
      {
        workspaceId: "workspace-1",
        dataSourceId: "source-1",
        syncedAt,
        pages: [
          {
            page: {
              id: "unchanged",
              title: "Getting Started",
              url: "https://notion.so/unchanged",
              lastEditedTime: "2024-01-01T00:00:00.000Z",
            },
            content: "old",
            pathSegments: ["Onboarding"],
          },
          {
            page: {
              id: "changed",
              title: "Getting Started",
              url: "https://notion.so/changed",
              lastEditedTime: "2024-01-05T00:00:00.000Z",
            },
            content: "new content",
            pathSegments: ["Onboarding"],
          },
          {
            page: {
              id: "archived",
              title: "Archived Note",
              url: "https://notion.so/archived",
              lastEditedTime: "2024-01-07T00:00:00.000Z",
            },
            content: "archived content",
            pathSegments: ["Archive"],
            archived: true,
          },
          {
            page: {
              id: "new-page",
              title: "New Document",
              url: "https://notion.so/new-page",
              lastEditedTime: "2024-01-09T00:00:00.000Z",
            },
            content: "brand new",
            pathSegments: [],
          },
        ],
        failures: [
          {
            pageId: "error-page",
            pageTitle: "Broken Page",
            reason: "API error: 500",
          },
        ],
      },
      store,
      {
        warn: (entry: { pageId: string; pageTitle?: string; reason: string }) => {
          logEntries.push(entry);
        },
      },
    );

    expect(result).toEqual({
      inserted: 1,
      updated: 1,
      archived: 1,
      skippedUnchanged: 1,
      failed: 1,
      failures: [
        {
          pageId: "error-page",
          pageTitle: "Broken Page",
          reason: "API error: 500",
        },
      ],
    });
    expect(upserts).toEqual([
      {
        externalId: "changed",
        status: "active",
        contentHash: changedHash,
        indexStatus: "pending",
      },
      {
        externalId: "archived",
        status: "archived",
        contentHash: archivedHash,
        indexStatus: "pending",
      },
      {
        externalId: "new-page",
        status: "active",
        contentHash: createHash("sha256").update("brand new").digest("hex"),
        indexStatus: "pending",
      },
    ]);
    expect(logEntries).toEqual([
      { pageId: "error-page", pageTitle: "Broken Page", reason: "API error: 500" },
    ]);
  });

  it("does not overwrite a newer stored document with a stale incoming page", async () => {
    let syncedAtCalls = 0;
    const logEntries: Array<{
      pageId: string;
      pageTitle?: string;
      reason: string;
    }> = [];
    const store: NotionSyncStore = {
      async findDocumentByExternalId(externalId: string) {
        if (externalId !== "stale-page") {
          return null;
        }

        return {
          externalUpdatedAt: new Date("2024-01-10T00:00:00.000Z"),
          status: "active",
          contentHash: null,
          indexStatus: "pending",
        };
      },
      async upsertDocument() {
        throw new Error("should not upsert stale document");
      },
      async markLastSyncedAt() {
        syncedAtCalls += 1;
        return undefined;
      },
    };

    const result = await syncNotionPages(
      {
        workspaceId: "workspace-1",
        dataSourceId: "source-1",
        syncedAt: new Date("2024-01-12T00:00:00.000Z"),
        pages: [
          {
            page: {
              id: "stale-page",
              title: "Stale Note",
              url: "https://notion.so/stale-page",
              lastEditedTime: "2024-01-05T00:00:00.000Z",
            },
            content: "older content",
            pathSegments: [],
          },
        ],
      },
      store,
      {
        warn: (entry: { pageId: string; pageTitle?: string; reason: string }) => {
          logEntries.push(entry);
        },
      },
    );

    expect(result).toEqual({
      inserted: 0,
      updated: 0,
      archived: 0,
      skippedUnchanged: 1,
      failed: 0,
      failures: [],
    });
    expect(logEntries).toEqual([]);
    expect(syncedAtCalls).toBe(1);
  });

  it("upserts a newer Notion page when only metadata changes and the content hash stays the same", async () => {
    const upserts: Array<{
      externalId: string;
      title: string;
      pathSegments: ReadonlyArray<string>;
      externalUpdatedAt: Date;
    }> = [];
    const sharedHash = createHash("sha256").update("shared content").digest("hex");
    const store: NotionSyncStore = {
      async findDocumentByExternalId(externalId: string) {
        if (externalId !== "metadata-page") {
          return null;
        }

        return {
          externalUpdatedAt: new Date("2024-01-01T00:00:00.000Z"),
          status: "active",
          contentHash: sharedHash,
          indexStatus: "pending",
        };
      },
      async upsertDocument(input) {
        upserts.push({
          externalId: input.externalId,
          title: input.title,
          pathSegments: input.metadata.pathSegments,
          externalUpdatedAt: input.externalUpdatedAt,
        });
      },
      async markLastSyncedAt() {
        return undefined;
      },
    };

    const result = await syncNotionPages(
      {
        workspaceId: "workspace-1",
        dataSourceId: "source-1",
        syncedAt: new Date("2024-01-12T00:00:00.000Z"),
        pages: [
          {
            page: {
              id: "metadata-page",
              title: "Getting Started v2",
              url: "https://notion.so/metadata-page",
              lastEditedTime: "2024-01-08T00:00:00.000Z",
            },
            content: "shared content",
            pathSegments: ["Docs", "Guides"],
          },
        ],
      },
      store,
      {
        warn: () => undefined,
      },
    );

    expect(result).toEqual({
      inserted: 0,
      updated: 1,
      archived: 0,
      skippedUnchanged: 0,
      failed: 0,
      failures: [],
    });
    expect(upserts).toEqual([
      {
        externalId: "metadata-page",
        title: "Getting Started v2",
        pathSegments: ["Docs", "Guides"],
        externalUpdatedAt: new Date("2024-01-08T00:00:00.000Z"),
      },
    ]);
  });

  it("does not overwrite a newer archived Notion document with an older archived snapshot", async () => {
    let syncedAtCalls = 0;
    const store: NotionSyncStore = {
      async findDocumentByExternalId(externalId: string) {
        if (externalId !== "archived-page") {
          return null;
        }

        return {
          externalUpdatedAt: new Date("2024-01-10T00:00:00.000Z"),
          status: "archived",
          contentHash: createHash("sha256").update("newer archived content").digest("hex"),
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

    const result = await syncNotionPages(
      {
        workspaceId: "workspace-1",
        dataSourceId: "source-1",
        syncedAt: new Date("2024-01-12T00:00:00.000Z"),
        pages: [
          {
            page: {
              id: "archived-page",
              title: "Archived Note",
              url: "https://notion.so/archived-page",
              lastEditedTime: "2024-01-05T00:00:00.000Z",
            },
            content: "older archived content",
            pathSegments: ["Archive"],
            archived: true,
          },
        ],
      },
      store,
      {
        warn: () => undefined,
      },
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

  it("skips a page with a missing timestamp and keeps the summary deterministic", async () => {
    const logEntries: Array<{
      pageId: string;
      pageTitle?: string;
      reason: string;
    }> = [];
    let syncedAtCalls = 0;
    const store: NotionSyncStore = {
      async findDocumentByExternalId() {
        return null;
      },
      async upsertDocument() {
        throw new Error("should not upsert");
      },
      async markLastSyncedAt() {
        syncedAtCalls += 1;
        return undefined;
      },
    };

    const result = await syncNotionPages(
      {
        workspaceId: "workspace-1",
        dataSourceId: "source-1",
        syncedAt: new Date("2024-01-10T00:00:00.000Z"),
        pages: [
          {
            page: {
              id: "missing-ts",
              title: "No Timestamp",
              url: "https://notion.so/missing-ts",
              lastEditedTime: "",
            },
            content: "content",
            pathSegments: [],
          },
        ],
      },
      store,
      {
        warn: (entry: { pageId: string; pageTitle?: string; reason: string }) => {
          logEntries.push(entry);
        },
      },
    );

    expect(result).toEqual({
      inserted: 0,
      updated: 0,
      archived: 0,
      skippedUnchanged: 0,
      failed: 1,
      failures: [
        {
          pageId: "missing-ts",
          pageTitle: "No Timestamp",
          reason: "Missing lastEditedTime",
        },
      ],
    });
    expect(logEntries).toEqual([
      {
        pageId: "missing-ts",
        pageTitle: "No Timestamp",
        reason: "Missing lastEditedTime",
      },
    ]);
    expect(syncedAtCalls).toBe(0);
  });

  it("normalizes the Notion summary to the Phase5 connector contract", () => {
    expect(
      normalizeNotionSyncSummary({
        inserted: 2,
        updated: 1,
        archived: 1,
        skippedUnchanged: 3,
        failed: 1,
        failures: [
          {
            pageId: "page-1",
            pageTitle: "Broken Page",
            reason: "API error",
          },
        ],
      }),
    ).toEqual({
      created: 2,
      updated: 1,
      skipped: 3,
      failed: 1,
      archived: 1,
      failures: [
        {
          sourceId: "page-1",
          sourceTitle: "Broken Page",
          reason: "API error",
        },
      ],
      index: {
        boundary: "phase6_chunking_deferred",
      },
    });
  });
});
