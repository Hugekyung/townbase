import { parseBasicAgentQuestion } from "../src/basic-agent-contract";
import type { BasicAgentResult } from "../src/basic-agent-contract";
// Compile-time regression: successful answers always name the actual model.
type Assert<T extends true> = T;
type AnswerRequiresModel = Assert<
  null extends Extract<BasicAgentResult, { status: "answered" }>["model"]
    ? false
    : true
>;
type RefusalAllowsNoModel = Assert<
  null extends Extract<BasicAgentResult, { status: "refused" }>["model"]
    ? true
    : false
>;
const input = {
  requestId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
  question: " 질문 원문 ",
  requestedMode: "auto",
};
describe("basic Agent question contract", () => {
  test("canonicalizes only request identity and preserves text", () => {
    expect(parseBasicAgentQuestion(input)).toEqual({
      ...input,
      requestId: input.requestId.toLowerCase(),
    });
  });
  test.each(["auto", "onboarding", "product_history", "documentation_gap"])(
    "accepts supported %s",
    (requestedMode) => {
      expect(
        parseBasicAgentQuestion({ ...input, requestedMode }).requestedMode,
      ).toBe(requestedMode);
    },
  );
  test.each([
    undefined,
    null,
    [],
    {},
    { ...input, requestId: "invalid" },
    { ...input, requestedMode: "change_impact" },
    { ...input, requestedMode: undefined },
    { ...input, question: "  \n" },
    { ...input, question: "\ud800" },
    { ...input, question: "a\u0000b" },
    { ...input, attachmentId: "not-allowed" },
  ])("rejects malformed/unsupported input", (value) => {
    expect(() => parseBasicAgentQuestion(value)).toThrow("invalid_request");
  });
  test("counts Unicode code points and rejects excess without truncating", () => {
    const atLimit = "😀".repeat(3999) + "가";
    expect(
      parseBasicAgentQuestion({ ...input, question: atLimit }).question,
    ).toBe(atLimit);
    for (const question of [
      "가".repeat(4001),
      "😀".repeat(4001),
      "a".repeat(1000000),
    ])
      expect(() => parseBasicAgentQuestion({ ...input, question })).toThrow(
        "question_too_long",
      );
  });
});
