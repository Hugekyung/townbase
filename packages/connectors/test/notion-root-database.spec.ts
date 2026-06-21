import { loadNotionDatabaseRootSnapshots } from "../src/notion/traverse";
import { loadNotionSyncPagesFromClient } from "../src/notion/live-sync";
import { createDatabaseRootClient } from "./notion-root-database.fixture";

describe("loadNotionSyncPagesFromClient database root", () => {
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

  it("processes database rows sequentially", async () => {
    const rowTwoRequested: { value: boolean } = { value: false };
    let resolveRowOne:
      | ((value: Awaited<ReturnType<ReturnType<typeof createDatabaseRootClient>["blocks"]["children"]["list"]>>) => void)
      | undefined;

    const baseClient = createDatabaseRootClient();
    const originalQuery = baseClient.blocks.children.list;

    const client: ReturnType<typeof createDatabaseRootClient> = {
      ...baseClient,
      blocks: {
        children: {
          list: async ({
            block_id,
            start_cursor,
          }: {
            block_id: string;
            start_cursor?: string;
          }) => {
          if (block_id === "row-1" && start_cursor === undefined) {
            return new Promise<Awaited<ReturnType<typeof originalQuery>>>((resolve) => {
              resolveRowOne = resolve;
            });
          }

            if (block_id === "row-2" && start_cursor === undefined) {
              rowTwoRequested.value = true;
            }

            return originalQuery({
              block_id,
              ...(start_cursor === undefined ? {} : { start_cursor }),
            });
          },
        },
      },
    };

    const promise = loadNotionDatabaseRootSnapshots(client, "db-root");

    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(rowTwoRequested.value).toBe(false);

    if (resolveRowOne === undefined) {
      throw new Error("row-1 block request was not observed");
    }

    resolveRowOne({
      results: [],
      next_cursor: null,
      has_more: false,
    });

    await expect(promise).resolves.toMatchObject({
      databaseTitle: "Knowledge Base",
    });
  });
});
