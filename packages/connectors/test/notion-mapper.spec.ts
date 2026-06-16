import {
  classifyNotionPage,
  mapNotionPageToDocumentDraft,
} from "../src/notion/mapping";

describe("classifyNotionPage", () => {
  it("maps onboarding and domain tags deterministically", () => {
    expect(
      classifyNotionPage({
        title: "Getting Started with Payments",
        pathSegments: ["Engineering", "Onboarding"],
        archived: undefined,
      }),
    ).toEqual({
      sourceType: "notion_page",
      knowledgeTypes: ["onboarding"],
      domainTags: ["payment", "onboarding"],
      status: "active",
      matchedRules: [
        "title:onboarding",
        "title:payment",
        "path:onboarding",
      ],
      classifierVersion: "phase2-v1",
    });
  });

  it("falls back to unknown knowledge classification when no rule matches", () => {
    expect(
      classifyNotionPage({
        title: "Random Notes",
        pathSegments: ["General"],
        archived: undefined,
      }),
    ).toEqual({
      sourceType: "notion_page",
      knowledgeTypes: ["unknown"],
      domainTags: [],
      status: "active",
      matchedRules: [],
      classifierVersion: "phase2-v1",
    });
  });

  it("keeps explicitly unarchived notion pages active even when the text mentions archive", () => {
    expect(
      classifyNotionPage({
        title: "Archive of Q1 Goals",
        pathSegments: ["General"],
        archived: false,
      }),
    ).toMatchObject({
      sourceType: "notion_page",
      knowledgeTypes: ["unknown"],
      domainTags: [],
      status: "active",
      classifierVersion: "phase2-v1",
    });
  });
});

describe("mapNotionPageToDocumentDraft", () => {
  it("maps a notion snapshot into a document draft", () => {
    expect(
      mapNotionPageToDocumentDraft({
        workspaceId: "workspace-1",
        dataSourceId: "source-1",
        page: {
          id: "page-1",
          title: "Getting Started with Payments",
          url: "https://notion.so/page-1",
          createdTime: "2024-01-01T00:00:00.000Z",
          lastEditedTime: "2024-01-03T01:02:03.000Z",
        },
        content: "Hello world",
        pathSegments: ["Engineering", "Onboarding"],
        archived: undefined,
      }),
    ).toEqual({
      workspaceId: "workspace-1",
      dataSourceId: "source-1",
      externalId: "page-1",
      sourceType: "notion_page",
      title: "Getting Started with Payments",
      url: "https://notion.so/page-1",
      content: "Hello world",
      status: "active",
      knowledgeTypes: ["onboarding"],
      domainTags: ["payment", "onboarding"],
      externalCreatedAt: new Date("2024-01-01T00:00:00.000Z"),
      externalUpdatedAt: new Date("2024-01-03T01:02:03.000Z"),
      metadata: {
        classifierVersion: "phase2-v1",
        matchedRules: [
          "title:onboarding",
          "title:payment",
          "path:onboarding",
        ],
        pathSegments: ["Engineering", "Onboarding"],
      },
    });
  });
});
