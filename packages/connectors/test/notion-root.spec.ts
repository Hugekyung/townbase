import { loadNotionSyncPagesFromClient } from "../src/sync";
import type { NotionClientLike } from "../src/notion";

type BlockRecord = Readonly<{
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
}>;

type PageRecord = Readonly<{
  id: string;
  url: string;
  created_time: string;
  last_edited_time: string;
  properties: {
    title: Array<{
      plain_text: string;
    }>;
  };
}>;

type DatabaseRecord = Readonly<{
  id: string;
  title: Array<{
    plain_text: string;
  }>;
  properties: Record<string, { type: string }>;
}>;

type DatabaseRowRecord = Readonly<{
  id: string;
  url: string;
  created_time: string;
  last_edited_time: string;
  properties: Record<string, unknown>;
}>;

const createPageRootClient = (): NotionClientLike => {
  const pages = new Map<string, PageRecord>([
    [
      "root",
      {
        id: "root",
        url: "https://notion.so/root",
        created_time: "2024-01-01T00:00:00.000Z",
        last_edited_time: "2024-01-01T00:00:00.000Z",
        properties: {
          title: [{ plain_text: "Engineering" }],
        },
      },
    ],
    [
      "root-child",
      {
        id: "root-child",
        url: "https://notion.so/root-child",
        created_time: "2024-01-02T00:00:00.000Z",
        last_edited_time: "2024-01-02T00:00:00.000Z",
        properties: {
          title: [{ plain_text: "Onboarding" }],
        },
      },
    ],
  ]);

  const blocks = new Map<string, Array<{ results: BlockRecord[]; next_cursor: string | null; has_more: boolean }>>([
    [
      "root",
      [
        {
          results: [
            {
              id: "root-paragraph",
              type: "paragraph",
              paragraph: {
                rich_text: [{ plain_text: "Root paragraph" }],
              },
            },
            {
              id: "root-child",
              type: "child_page",
              child_page: {
                title: "Onboarding",
              },
            },
          ],
          next_cursor: null,
          has_more: false,
        },
      ],
    ],
    [
      "root-child",
      [
        {
          results: [
            {
              id: "child-paragraph",
              type: "paragraph",
              paragraph: {
                rich_text: [{ plain_text: "Child paragraph" }],
              },
            },
          ],
          next_cursor: null,
          has_more: false,
        },
      ],
    ],
  ]);

  return {
    pages: {
      retrieve: async ({ page_id }: { page_id: string }) => {
        const page = pages.get(page_id);

        if (page === undefined) {
          throw new Error(`Missing page: ${page_id}`);
        }

        return page;
      },
    },
    blocks: {
      children: {
        list: async ({
          block_id,
          start_cursor,
        }: {
          block_id: string;
          start_cursor?: string;
        }) => {
          if (start_cursor !== undefined) {
            throw new Error(`Unexpected pagination cursor for block: ${block_id}`);
          }

          const pageBlocks = blocks.get(block_id);

          if (pageBlocks === undefined) {
            throw new Error(`Missing block children: ${block_id}`);
          }

          return pageBlocks[0]!;
        },
      },
    },
  };
};

const createDatabaseRootClient = (): NotionClientLike => {
  const pages = new Map<string, PageRecord>([
    [
      "row-1",
      {
        id: "row-1",
        url: "https://notion.so/row-1",
        created_time: "2024-01-03T00:00:00.000Z",
        last_edited_time: "2024-01-03T00:00:00.000Z",
        properties: {
          title: [{ plain_text: "Row One" }],
        },
      },
    ],
    [
      "row-1-child",
      {
        id: "row-1-child",
        url: "https://notion.so/row-1-child",
        created_time: "2024-01-03T00:00:00.000Z",
        last_edited_time: "2024-01-03T00:00:00.000Z",
        properties: {
          title: [{ plain_text: "Child Page" }],
        },
      },
    ],
    [
      "row-2",
      {
        id: "row-2",
        url: "https://notion.so/row-2",
        created_time: "2024-01-04T00:00:00.000Z",
        last_edited_time: "2024-01-04T00:00:00.000Z",
        properties: {
          title: [{ plain_text: "Row Two" }],
        },
      },
    ],
  ]);

  const blocks = new Map<string, Array<{ results: BlockRecord[]; next_cursor: string | null; has_more: boolean }>>([
    [
      "row-1",
      [
        {
          results: [
            {
              id: "row-1-paragraph",
              type: "paragraph",
              paragraph: {
                rich_text: [{ plain_text: "Database row paragraph" }],
              },
            },
            {
              id: "row-1-child",
              type: "child_page",
              child_page: {
                title: "Child Page",
              },
            },
          ],
          next_cursor: null,
          has_more: false,
        },
      ],
    ],
    [
      "row-1-child",
      [
        {
          results: [
            {
              id: "row-1-child-note",
              type: "paragraph",
              paragraph: {
                rich_text: [{ plain_text: "Nested child content" }],
              },
            },
          ],
          next_cursor: null,
          has_more: false,
        },
      ],
    ],
    [
      "row-2",
      [
        {
          results: [
            {
              id: "row-2-heading",
              type: "heading_1",
              heading_1: {
                rich_text: [{ plain_text: "Row Two Heading" }],
              },
            },
          ],
          next_cursor: null,
          has_more: false,
        },
      ],
    ],
  ]);

  const database: DatabaseRecord = {
    id: "db-root",
    title: [{ plain_text: "Knowledge Base" }],
    properties: {
      name: {
        type: "title",
      },
      status: {
        type: "select",
      },
    },
  };

  const rows: DatabaseRowRecord[] = [
    {
      id: "row-1",
      url: "https://notion.so/row-1",
      created_time: "2024-01-03T00:00:00.000Z",
      last_edited_time: "2024-01-03T00:00:00.000Z",
      properties: {
        name: {
          id: "title",
          type: "title",
          title: [{ plain_text: "Row One" }],
        },
      },
    },
    {
      id: "row-2",
      url: "https://notion.so/row-2",
      created_time: "2024-01-04T00:00:00.000Z",
      last_edited_time: "2024-01-04T00:00:00.000Z",
      properties: {
        name: {
          id: "title",
          type: "title",
          title: [{ plain_text: "Row Two" }],
        },
      },
    },
  ];

  return {
    pages: {
      retrieve: async ({ page_id }: { page_id: string }) => {
        if (page_id === "db-root") {
          throw new Error(
            "Provided ID db-root is a database, not a page. Use the retrieve database API instead.",
          );
        }

        const page = pages.get(page_id);

        if (page === undefined) {
          throw new Error(`Missing page: ${page_id}`);
        }

        return page;
      },
    },
    blocks: {
      children: {
        list: async ({
          block_id,
          start_cursor,
        }: {
          block_id: string;
          start_cursor?: string;
        }) => {
          if (start_cursor !== undefined) {
            throw new Error(`Unexpected pagination cursor for block: ${block_id}`);
          }

          const pageBlocks = blocks.get(block_id);

          if (pageBlocks === undefined) {
            throw new Error(`Missing block children: ${block_id}`);
          }

          return pageBlocks[0]!;
        },
      },
    },
    databases: {
      retrieve: async ({ database_id }: { database_id: string }) => {
        if (database_id !== "db-root") {
          throw new Error(`Missing database: ${database_id}`);
        }

        return database;
      },
      query: async ({
        database_id,
        start_cursor,
      }: {
        database_id: string;
        start_cursor?: string;
      }) => {
        if (database_id !== "db-root") {
          throw new Error(`Missing database: ${database_id}`);
        }

        if (start_cursor !== undefined) {
          throw new Error(`Unexpected database pagination cursor: ${start_cursor}`);
        }

        return {
          results: rows,
          next_cursor: null,
          has_more: false,
        };
      },
    },
  };
};

describe("loadNotionSyncPagesFromClient", () => {
  it("preserves the existing page-root flattening contract", async () => {
    await expect(loadNotionSyncPagesFromClient(createPageRootClient(), "root")).resolves.toEqual([
      {
        page: {
          id: "root",
          title: "Engineering",
          url: "https://notion.so/root",
          createdTime: "2024-01-01T00:00:00.000Z",
          lastEditedTime: "2024-01-01T00:00:00.000Z",
        },
        content: "Root paragraph",
        pathSegments: [],
      },
      {
        page: {
          id: "root-child",
          title: "Onboarding",
          url: "https://notion.so/root-child",
          createdTime: "2024-01-02T00:00:00.000Z",
          lastEditedTime: "2024-01-02T00:00:00.000Z",
        },
        content: "Child paragraph",
        pathSegments: ["Engineering"],
      },
    ]);
  });

  it("detects a database root and flattens row pages under the database title", async () => {
    await expect(
      loadNotionSyncPagesFromClient(createDatabaseRootClient(), "db-root"),
    ).resolves.toEqual([
      {
        page: {
          id: "row-1",
          title: "Row One",
          url: "https://notion.so/row-1",
          createdTime: "2024-01-03T00:00:00.000Z",
          lastEditedTime: "2024-01-03T00:00:00.000Z",
        },
        content: "Database row paragraph",
        pathSegments: ["Knowledge Base"],
      },
      {
        page: {
          id: "row-1-child",
          title: "Child Page",
          url: "https://notion.so/row-1-child",
          createdTime: "2024-01-03T00:00:00.000Z",
          lastEditedTime: "2024-01-03T00:00:00.000Z",
        },
        content: "Nested child content",
        pathSegments: ["Knowledge Base", "Row One"],
      },
      {
        page: {
          id: "row-2",
          title: "Row Two",
          url: "https://notion.so/row-2",
          createdTime: "2024-01-04T00:00:00.000Z",
          lastEditedTime: "2024-01-04T00:00:00.000Z",
        },
        content: "Row Two Heading",
        pathSegments: ["Knowledge Base"],
      },
    ]);
  });

  it("rejects an unsupported root deterministically", async () => {
    const client: NotionClientLike = {
      pages: {
        retrieve: async () => {
          throw new Error("Missing page: unknown-root");
        },
      },
      blocks: {
        children: {
          list: async () => {
            throw new Error("Missing block children: unknown-root");
          },
        },
      },
      databases: {
        retrieve: async () => {
          throw new Error("Missing database: unknown-root");
        },
        query: async () => {
          throw new Error("Missing database: unknown-root");
        },
      },
    };

    await expect(
      loadNotionSyncPagesFromClient(client, "unknown-root"),
    ).rejects.toThrow("did not resolve to a page or database");
  });
});
