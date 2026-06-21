import { flattenNotionPageSnapshots } from "../src/sync";
import type { NotionPageSnapshot } from "../src/notion";

describe("flattenNotionPageSnapshots", () => {
  it("keeps the root page and derives ancestor path segments for child pages", () => {
    const snapshot: NotionPageSnapshot = {
      page: {
        id: "root-page",
        title: "Engineering",
        url: "https://notion.so/root-page",
        createdTime: "2024-01-01T00:00:00.000Z",
        lastEditedTime: "2024-01-02T00:00:00.000Z",
      },
      content: "Root content",
      childPages: [
        {
          page: {
            id: "child-page",
            title: "Onboarding",
            url: "https://notion.so/child-page",
            createdTime: "2024-01-03T00:00:00.000Z",
            lastEditedTime: "2024-01-04T00:00:00.000Z",
          },
          content: "Child content",
          childPages: [],
          unsupportedBlockIds: [],
        },
      ],
      unsupportedBlockIds: [],
    };

    expect(flattenNotionPageSnapshots(snapshot)).toEqual([
      {
        page: snapshot.page,
        content: "Root content",
        pathSegments: [],
      },
      {
        page: snapshot.childPages[0]!.page,
        content: "Child content",
        pathSegments: ["Engineering"],
      },
    ]);
  });
});
