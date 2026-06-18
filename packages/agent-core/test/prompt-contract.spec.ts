import { buildEmptyPromptContext, PROMPT_RESPONSE_SCHEMA_KEYS, SOURCE_GROUNDED_ANSWER_RULE } from "../src/prompt-contract";

describe("prompt contract", () => {
  it("exports the minimal response schema keys", () => {
    expect(PROMPT_RESPONSE_SCHEMA_KEYS).toEqual([
      "answer",
      "isAnswerable",
      "confidence",
      "knowledgeGap",
      "suggestedFollowups",
    ]);
  });

  it("keeps the source-grounded answer rule explicit", () => {
    expect(SOURCE_GROUNDED_ANSWER_RULE).toContain("Only from the provided sources");
    expect(SOURCE_GROUNDED_ANSWER_RULE).toContain("Always cite the source rows");
  });

  it("builds an empty prompt context without sources", () => {
    const context = buildEmptyPromptContext({
      question: "How do I start?",
      requestedMode: "onboarding",
      resolvedMode: "onboarding",
    });

    expect(context).toMatchObject({
      question: "How do I start?",
      requestedMode: "onboarding",
      resolvedMode: "onboarding",
      sourceCount: 0,
      sourceSummary: "No traced sources were selected.",
      sourceCitations: [],
    });
  });
});
