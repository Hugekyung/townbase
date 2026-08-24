import {
  parseChatQuestionInput,
  type ChatQuestionInput,
} from "../src/chat";

describe("chat question contract", () => {
  it("rejects missing question and mode", () => {
    expect(() => parseChatQuestionInput({})).toThrow(
      "question and mode are required",
    );
  });

  it("allows workspaceId to be resolved by the server default", () => {
    expect(parseChatQuestionInput({ question: "What changed?", mode: "auto" })).toEqual({
      question: "What changed?",
      mode: "auto",
      topK: 5,
    });
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
      topK: 5,
    });
  });

  it("defaults topK to 5 and rejects invalid values", () => {
    expect(() =>
      parseChatQuestionInput({
        workspaceId: "workspace-1",
        question: "What changed?",
        mode: "auto",
        topK: 0,
      }),
    ).toThrow("topK must be an integer between 1 and 50");

    expect(() =>
      parseChatQuestionInput({
        workspaceId: "workspace-1",
        question: "What changed?",
        mode: "auto",
        topK: 51,
      }),
    ).toThrow("topK must be an integer between 1 and 50");

    expect(parseChatQuestionInput({
      workspaceId: "workspace-1",
      question: "What changed?",
      mode: "auto",
      topK: 3,
    }).topK).toBe(3);
  });
});
