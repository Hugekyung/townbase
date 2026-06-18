import {
  parseChatQuestionInput,
  type ChatQuestionInput,
} from "../src/chat";

describe("chat question contract", () => {
  it("rejects missing workspaceId, question, and mode", () => {
    expect(() => parseChatQuestionInput({})).toThrow(
      "workspaceId, question, and mode are required",
    );
  });

  it("rejects blank or unsupported question fields", () => {
    expect(() =>
      parseChatQuestionInput({
        workspaceId: "  ",
        question: "What changed?",
        mode: "auto",
      }),
    ).toThrow("workspaceId must be a non-empty string");

    expect(() =>
      parseChatQuestionInput({
        workspaceId: "workspace-1",
        question: "   ",
        mode: "auto",
      }),
    ).toThrow("question must be a non-empty string");

    expect(() =>
      parseChatQuestionInput({
        workspaceId: "workspace-1",
        question: "What changed?",
        mode: "unsupported",
      }),
    ).toThrow("mode must be one of the supported MCP question modes");
  });

  it("normalizes valid question inputs", () => {
    const parsed: ChatQuestionInput = parseChatQuestionInput({
      workspaceId: " workspace-1 ",
      question: " What changed? ",
      mode: "auto",
    });

    expect(parsed).toEqual({
      workspaceId: "workspace-1",
      question: "What changed?",
      mode: "auto",
    });
  });
});
