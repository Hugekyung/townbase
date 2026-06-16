import { syncNotionPages, type NotionSyncStore } from "../src/notion/sync";
import type { DocumentStatus } from "../src/classification";

describe("syncNotionPages", () => {
  it("skips unchanged pages, upserts changed pages once, and records failures", async () => {
    const upserts: Array<{ externalId: string; status: string }> = [];
    const syncedAt = new Date("2024-01-10T00:00:00.000Z");
    const logEntries: Array<{
      pageId: string;
      pageTitle?: string;
      reason: string;
    }> = [];
    const store: NotionSyncStore & {
      documents: Map<
        string,
        { externalUpdatedAt: Date | null; status: DocumentStatus }
      >;
    } = {
      documents: new Map<string, { externalUpdatedAt: Date | null; status: DocumentStatus }>([
        [
          "unchanged",
          {
            externalUpdatedAt: new Date("2024-01-01T00:00:00.000Z"),
            status: "active",
          },
        ],
        [
          "changed",
          {
            externalUpdatedAt: new Date("2024-01-01T00:00:00.000Z"),
            status: "active",
          },
        ],
        [
          "archived",
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
      { externalId: "changed", status: "active" },
      { externalId: "archived", status: "archived" },
      { externalId: "new-page", status: "active" },
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
});
