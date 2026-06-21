import { loadNotionSyncPagesFromClient } from "../src/notion/live-sync";
import type { NotionClientLike } from "../src/notion";
import { createUnsupportedRootClient } from "./notion-root-unsupported.fixture";

describe("loadNotionSyncPagesFromClient root errors", () => {
  it("rejects an unsupported root deterministically", async () => {
    await expect(
      loadNotionSyncPagesFromClient(createUnsupportedRootClient(), "unknown-root"),
    ).rejects.toThrow("did not resolve to a page or database");
  });

  it("propagates non-404 page retrieval failures without falling back to databases", async () => {
    const databaseRetrieved = jest.fn();

    const client: NotionClientLike = {
      pages: {
        retrieve: async () => {
          throw {
            status: 401,
            message: "Unauthorized",
          };
        },
      },
      blocks: {
        children: {
          list: async () => {
            throw new Error("Not expected");
          },
        },
      },
      databases: {
        retrieve: async () => {
          databaseRetrieved();
          throw new Error("Database fallback should not run for auth failures");
        },
        query: async () => {
          throw new Error("Database fallback should not run for auth failures");
        },
      },
    };

    await expect(loadNotionSyncPagesFromClient(client, "root")).rejects.toMatchObject({
      status: 401,
      message: "Unauthorized",
    });
    expect(databaseRetrieved).not.toHaveBeenCalled();
  });
});
