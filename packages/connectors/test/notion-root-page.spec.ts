import { loadNotionSyncPagesFromClient } from "../src/notion/live-sync";
import { createPageRootClient } from "./notion-root-page.fixture";

describe("loadNotionSyncPagesFromClient page root", () => {
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
});
