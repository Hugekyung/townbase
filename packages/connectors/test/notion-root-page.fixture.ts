import type { NotionClientLike } from "../src/notion";
import type { BlockRecord, PageRecord } from "./notion-root.types";

export const createPageRootClient = (): NotionClientLike => {
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
