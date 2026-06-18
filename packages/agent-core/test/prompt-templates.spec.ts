import {
  COMMON_SYSTEM_PROMPT,
  FALLBACK_PROMPT,
  isFallbackPrompt,
  resolvePromptTemplate,
  summarizeTraceSources,
} from "../src/prompt-templates";

describe("prompt templates", () => {
  it("selects the onboarding prompt for onboarding mode", () => {
    expect(resolvePromptTemplate("onboarding", 1)).not.toBe(FALLBACK_PROMPT);
    expect(resolvePromptTemplate("onboarding", 1)).toContain("learning order");
  });

  it("selects the product history prompt for product history mode", () => {
    expect(resolvePromptTemplate("product_history", 2)).toContain("decision background");
  });

  it("selects the documentation gap prompt for documentation gap mode", () => {
    expect(resolvePromptTemplate("documentation_gap", 2)).toContain("missing documentation");
  });

  it("falls back for reserved change impact mode", () => {
    expect(resolvePromptTemplate("change_impact", 2)).toBe(FALLBACK_PROMPT);
  });

  it("falls back when the traced context is too weak", () => {
    expect(resolvePromptTemplate("onboarding", 0)).toBe(FALLBACK_PROMPT);
    expect(isFallbackPrompt(0, 0.8)).toBe(true);
    expect(isFallbackPrompt(3, 0.4)).toBe(true);
  });

  it("keeps the common system prompt source-grounded", () => {
    expect(COMMON_SYSTEM_PROMPT).toContain("source-grounded");
  });

  it("summarizes trace sources deterministically", () => {
    const summary = summarizeTraceSources([
      {
        documentId: "doc-1",
        chunkId: "chunk-1",
        sourceType: "repo_docs",
        title: "README",
        filePath: "packages/agent-core/README.md",
        sourceUrl: null,
        sectionTitle: "Intro",
        headingPath: ["Intro"],
        rank: 1,
        score: 0.92,
      },
    ]);

    expect(summary).toContain("[1] README (repo_docs)");
    expect(summary).toContain("file:packages/agent-core/README.md");
    expect(summary).toContain("heading:Intro");
    expect(summary).toContain("score:0.92");
  });
});
