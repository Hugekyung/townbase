import { buildPromptContext } from "../src/context-builder";

describe("prompt context builder", () => {
  it("converts traced sources into prompt-ready context", () => {
    const context = buildPromptContext({
      question: "Why did this change?",
      requestedMode: "product_history",
      resolvedMode: "product_history",
      sources: [
        {
          documentId: "doc-1",
          chunkId: "chunk-1",
          sourceType: "prd",
          title: "Phase 7 PRD",
          filePath: null,
          sourceUrl: "https://example.com/prd",
          sectionTitle: "Decision",
          headingPath: ["Decision"],
          rank: 1,
          score: 0.97,
        },
      ],
    });

    expect(context).toMatchObject({
      question: "Why did this change?",
      requestedMode: "product_history",
      resolvedMode: "product_history",
      sourceCount: 1,
    });
    expect(context.sourceSummary).toContain("Phase 7 PRD");
    expect(context.sourceSummary).toContain("url:https://example.com/prd");
    expect(context.sourceCitations).toEqual([
      "1. Phase 7 PRD — https://example.com/prd — Decision",
    ]);
  });
});
