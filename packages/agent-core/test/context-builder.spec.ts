import { buildPromptContext } from "../src/context-builder";
import type { PromptTraceSource } from "../src/prompt-contract";

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

  it("omits undefined filePath and sourceUrl from source citations at runtime", () => {
    const runtimeSource = {
      documentId: "doc-2",
      chunkId: "chunk-2",
      sourceType: "notion_page",
      title: "Planning Note",
      filePath: undefined,
      sourceUrl: undefined,
      sectionTitle: null,
      headingPath: [],
      rank: 2,
      score: 0.84,
    } as unknown as PromptTraceSource;

    const context = buildPromptContext({
      question: "What changed?",
      requestedMode: "onboarding",
      resolvedMode: "onboarding",
      sources: [runtimeSource],
    });

    expect(context.sourceCitations).toEqual(["2. Planning Note"]);
  });
});
