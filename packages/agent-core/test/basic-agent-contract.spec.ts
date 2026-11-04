import { parseBasicAgentQuestion } from "../src/basic-agent-contract";
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
    expect(
      parseBasicAgentQuestion({ ...input, question: "😀".repeat(4000) })
        .question,
    ).toHaveLength(8000);
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
