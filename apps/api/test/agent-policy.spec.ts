import {
  canonicalAgent,
  validAgentConfiguration,
} from "../src/agent/agent-policy";
const id = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
const config = {
  name: "도우미",
  purpose: "회사 문서 답변",
  instructions: "",
  terminology: [{ term: "출고", meaning: "창고에서 발송" }],
  sourceSelection: "selected",
  sourceOriginalIds: [id],
};
describe("E01 Agent settings boundary", () => {
  test("canonicalizes source identities without altering instructions", () => {
    const laterId = "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB";
    const input = {
      ...config,
      sourceSelection: "selected" as const,
      sourceOriginalIds: [laterId, id],
    };
    expect(validAgentConfiguration(input)).toBe(true);
    expect(canonicalAgent(input)).toEqual({
      ...input,
      sourceOriginalIds: [id.toLowerCase(), laterId.toLowerCase()],
    });
  });
  test.each([
    undefined,
    null,
    [],
    {},
    { ...config, name: " " },
    { ...config, purpose: "\u0000" },
    { ...config, instructions: "\ud800" },
    { ...config, name: "가".repeat(129) },
    { ...config, instructions: " ".repeat(1000000) },
    { ...config, sourceSelection: "all" },
    { ...config, sourceSelection: "other" },
    { ...config, sourceOriginalIds: [id, id.toLowerCase()] },
    { ...config, sourceOriginalIds: Array(1) },
    { ...config, sourceOriginalIds: Object.assign(Array(1), { extra: id }) },
    { ...config, sourceOriginalIds: Object.assign([id], { extra: id }) },
    { ...config, sourceOriginalIds: [null] },
    { ...config, sourceOriginalIds: Array(201).fill(id) },
    { ...config, terminology: Array(1) },
    {
      ...config,
      terminology: [
        { term: "출고", meaning: "a" },
        { term: " 출고 ", meaning: "b" },
      ],
    },
    {
      ...config,
      terminology: [{ term: "a", meaning: "b", instructions: "override" }],
    },
    { ...config, answerModel: "unapproved-model" },
    { ...config, embeddingModel: "other" },
  ])("rejects malformed/expanded settings", (value) => {
    expect(validAgentConfiguration(value)).toBe(false);
  });
  test("explicit empty selection is safe and Unicode limits use code points", () => {
    expect(
      validAgentConfiguration({
        ...config,
        name: "😀".repeat(128),
        sourceOriginalIds: [],
      }),
    ).toBe(true);
    expect(
      validAgentConfiguration({
        ...config,
        sourceSelection: "all",
        sourceOriginalIds: [],
      }),
    ).toBe(true);
  });
});
