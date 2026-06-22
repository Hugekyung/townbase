import {
  loadNotionPageSnapshot,
  type NotionClientLike,
} from "../src/notion/traverse";

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

const createMockClient = (): NotionClientLike => {
  const pages = new Map<string, PageRecord>([
    [
      "root",
      {
        id: "root",
        url: "https://notion.so/root",
        created_time: "2024-01-01T00:00:00.000Z",
        last_edited_time: "2024-01-01T00:00:00.000Z",
        properties: {
          title: [{ plain_text: "Root Page" }],
        },
      },
    ],
    [
      "root-child-page",
      {
        id: "root-child-page",
        url: "https://notion.so/child",
        created_time: "2024-01-02T00:00:00.000Z",
        last_edited_time: "2024-01-02T00:00:00.000Z",
        properties: {
          title: [{ plain_text: "Child Page" }],
        },
      },
    ],
  ]);

  const children = new Map<string, Array<{ results: BlockRecord[]; next_cursor: string | null; has_more: boolean }>>([
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
              id: "root-child-page",
              type: "child_page",
              child_page: {
                title: "Child Page",
              },
            },
          ],
          next_cursor: "page-2",
          has_more: true,
        },
        {
          results: [
            {
              id: "root-note",
              type: "heading_1",
              heading_1: {
                rich_text: [{ plain_text: "Root Heading" }],
              },
            },
          ],
          next_cursor: null,
          has_more: false,
        },
      ],
    ],
    [
      "root-child-page",
      [
        {
          results: [
            {
              id: "child-list",
              type: "bulleted_list_item",
              bulleted_list_item: {
                rich_text: [{ plain_text: "Child bullet" }],
              },
            },
            {
              id: "child-unsupported",
              type: "unsupported",
            },
            {
              id: "root",
              type: "child_page",
              child_page: {
                title: "Root Page",
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
          const pageChildren = children.get(block_id);

          if (pageChildren === undefined) {
            throw new Error(`Missing block children: ${block_id}`);
          }

          if (start_cursor === undefined) {
            return pageChildren[0]!;
          }

          return pageChildren[1]!;
        },
      },
    },
  };
};

describe("loadNotionPageSnapshot", () => {
  it("preserves pagination order and traverses child pages", async () => {
    const snapshot = await loadNotionPageSnapshot(createMockClient(), "root");

    expect(snapshot.page.title).toBe("Root Page");
    expect(snapshot.page.url).toBe("https://notion.so/root");
    expect(snapshot.page.lastEditedTime).toBe("2024-01-01T00:00:00.000Z");
    expect(snapshot.content).toBe("Root paragraph\nRoot Heading");
    expect(snapshot.childPages).toHaveLength(1);
    expect(snapshot.childPages[0]?.page.title).toBe("Child Page");
    expect(snapshot.childPages[0]?.content).toBe("Child bullet");
  });

  it("skips unsupported blocks without crashing traversal", async () => {
    const snapshot = await loadNotionPageSnapshot(
      createMockClient(),
      "root-child-page",
    );

    expect(snapshot.content).toBe("Child bullet");
    expect(snapshot.unsupportedBlockIds).toEqual(["child-unsupported"]);
  });

  it("stops when a child page points back to an ancestor", async () => {
    const client = createMockClient();
    const snapshot = await loadNotionPageSnapshot(client, "root");

    expect(snapshot.childPages).toHaveLength(1);
    expect(snapshot.childPages[0]?.page.id).toBe("root-child-page");
    expect(snapshot.childPages[0]?.childPages).toHaveLength(0);
  });

  it("logs each page as it is read", async () => {
    const logs: string[] = [];

    await loadNotionPageSnapshot(createMockClient(), "root", new Set<string>(), {
      info: (message) => {
        logs.push(message);
      },
    });

    expect(logs).toEqual([
      "Notion sync: reading page Root Page (root)",
      "Notion sync: reading page Child Page (root-child-page)",
    ]);
  });
});
