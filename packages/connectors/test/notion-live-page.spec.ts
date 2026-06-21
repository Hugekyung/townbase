import { normalizeLiveNotionPageRecord } from "../src/notion/live-page";

describe("normalizeLiveNotionPageRecord", () => {
  it("preserves the Notion page title when present", () => {
    const record = normalizeLiveNotionPageRecord({
      object: "page",
      id: "page-1",
      url: "https://notion.so/page-1",
      created_time: "2024-01-01T00:00:00.000Z",
      last_edited_time: "2024-01-02T00:00:00.000Z",
      properties: {
        title: [{ plain_text: "Payments" }],
      },
    });

    expect(record.properties.title).toEqual([{ plain_text: "Payments" }]);
  });

  it("falls back to Untitled when the title property is missing", () => {
    const record = normalizeLiveNotionPageRecord({
      object: "page",
      id: "page-2",
      url: "https://notion.so/page-2",
      created_time: "2024-01-01T00:00:00.000Z",
      last_edited_time: "2024-01-02T00:00:00.000Z",
      properties: {},
    });

    expect(record.properties.title).toEqual([{ plain_text: "Untitled" }]);
  });
});
