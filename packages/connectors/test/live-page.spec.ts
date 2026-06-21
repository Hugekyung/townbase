import { normalizeLiveNotionPageRecord } from "../src/notion/live-page";

describe("normalizeLiveNotionPageRecord", () => {
  it("extracts the title from a live Notion title property object", () => {
    expect(
      normalizeLiveNotionPageRecord({
        object: "page",
        id: "page-1",
        url: "https://notion.so/page-1",
        created_time: "2026-06-21T00:00:00.000Z",
        last_edited_time: "2026-06-21T00:00:00.000Z",
        properties: {
          Name: {
            id: "title",
            type: "title",
            title: [{ plain_text: "Engineering Notes" }],
          },
        },
      }),
    ).toEqual({
      id: "page-1",
      url: "https://notion.so/page-1",
      created_time: "2026-06-21T00:00:00.000Z",
      last_edited_time: "2026-06-21T00:00:00.000Z",
      properties: {
        title: [{ plain_text: "Engineering Notes" }],
      },
    });
  });

  it("falls back to Untitled when no title property is present", () => {
    expect(
      normalizeLiveNotionPageRecord({
        object: "page",
        id: "page-2",
        url: "https://notion.so/page-2",
        created_time: "2026-06-21T00:00:00.000Z",
        last_edited_time: "2026-06-21T00:00:00.000Z",
        properties: {},
      }),
    ).toEqual({
      id: "page-2",
      url: "https://notion.so/page-2",
      created_time: "2026-06-21T00:00:00.000Z",
      last_edited_time: "2026-06-21T00:00:00.000Z",
      properties: {
        title: [{ plain_text: "Untitled" }],
      },
    });
  });
});
