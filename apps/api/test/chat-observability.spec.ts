import { parseChatQuestionResponse, scoreQuestionConfidence } from "../src/chat";

describe("chat observability helpers", () => {
  it("rejects malformed model output deterministically", () => {
    expect(() => parseChatQuestionResponse("{ not json }", 1)).toThrow("JSON");
  });

  it("clamps confidence scores within the valid range", () => {
    expect(
      scoreQuestionConfidence({
        parsedConfidence: 1.2,
        sourceCount: 4,
        topScore: 0.99,
        isAnswerable: true,
      }),
    ).toBe(1);

    expect(
      scoreQuestionConfidence({
        parsedConfidence: -0.2,
        sourceCount: 0,
        topScore: -1,
        isAnswerable: false,
      }),
    ).toBe(0);
  });
});
