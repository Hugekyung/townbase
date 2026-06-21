import type { NotionClientLike } from "../src/notion";
import type {
  BlockRecord,
  DatabaseRecord,
  DatabaseRowRecord,
  PageRecord,
} from "./notion-root.types";

export const createDatabaseRootClient = (): NotionClientLike => {
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
          throw {
            status: 400,
            code: "validation_error",
            message: "Provided ID db-root is a database, not a page. Use the retrieve database API instead.",
          };
        }

        const page = pages.get(page_id);

        if (page === undefined) {
          throw {
            status: 404,
            code: "object_not_found",
            message: `Missing page: ${page_id}`,
          };
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
          throw {
            status: 404,
            code: "object_not_found",
            message: `Missing database: ${database_id}`,
          };
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
          throw {
            status: 404,
            code: "object_not_found",
            message: `Missing database: ${database_id}`,
          };
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
