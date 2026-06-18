import {
  classifyChatQuestionMode,
  parseChatQuestionInput,
  resolveChatQuestionSelection,
} from "../src/chat";

describe("chat mode resolution", () => {
  it("resolves auto onboarding questions deterministically", () => {
    const input = parseChatQuestionInput({
      workspaceId: "workspace-1",
      question: "How do I run the workspace locally?",
      mode: "auto",
    });

    expect(classifyChatQuestionMode(input.question)).toBe("onboarding");
    expect(resolveChatQuestionSelection(input)).toEqual({
      requestedMode: "auto",
      resolvedMode: "onboarding",
      strategy: expect.objectContaining({
        mode: "onboarding",
      }),
    });
  });

  it("resolves auto documentation-gap questions deterministically", () => {
    const input = parseChatQuestionInput({
      workspaceId: "workspace-1",
      question: "What is missing from the docs?",
      mode: "auto",
    });

    expect(classifyChatQuestionMode(input.question)).toBe("documentation_gap");
    expect(resolveChatQuestionSelection(input)).toEqual({
      requestedMode: "auto",
      resolvedMode: "documentation_gap",
      strategy: expect.objectContaining({
        mode: "documentation_gap",
      }),
    });
  });

  it("keeps explicit modes deterministic without auto classification", () => {
    const input = parseChatQuestionInput({
      workspaceId: "workspace-1",
      question: "Why did we introduce phase 7?",
      mode: "product_history",
    });

    expect(resolveChatQuestionSelection(input)).toEqual({
      requestedMode: "product_history",
      resolvedMode: "product_history",
      strategy: expect.objectContaining({
        mode: "product_history",
      }),
    });
  });
});
