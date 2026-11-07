import { createHash } from "node:crypto";
import {
  questionInput,
  resolvedMode,
  selectSources,
  promptFor,
  parseGroundedResult,
  callId,
  type RagSource,
} from "../src/rag/rag-policy";
import { isRagQuestion } from "../src/rag/rag-http";
import {
  MIN_INPUT_TOKEN_LIMIT,
  inputBound,
} from "../src/model-integration/model-policy";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const source = (overrides: Partial<RagSource> = {}): RagSource => {
  const content = "등록 문서에 기록된 발송 절차입니다.";
  return {
    id,
    indexId: id,
    originalId: id,
    versionId: id,
    scopeRevision: 1,
    content,
    title: "배송 절차",
    fileName: "guide.txt",
    format: "txt",
    contentHash: "x",
    chunkHash: createHash("sha256").update(content).digest("hex"),
    locations: [
      {
        segment: 0,
        start: 0,
        end: 20,
        location: { lineStart: 1, lineEnd: 1 },
        headingPath: [],
      },
    ],
    headingPath: [],
    sourceType: "uploaded_file",
    knowledgeTypes: ["unknown"],
    domainTags: [],
    status: "active",
    sourcePriority: 50,
    requestedMode: null,
    resolvedMode: null,
    score: 0.8,
    reference: "/files/" + id + "/reference",
    ...overrides,
  };
};
const valid = {
  isAnswerable: true,
  reason: "",
  claims: [
    {
      text: "문서의 발송 절차를 따릅니다.",
      evidence: [{ sourceId: id, quote: "발송 절차" }],
    },
  ],
  conflicts: [],
};
describe("RAG question and grounded evidence contracts", () => {
  test.each(["onboarding", "product_history", "documentation_gap"] as const)(
    "minimum configured input budget admits a short sourced %s prompt without truncation",
    (mode) => {
      const prompt = promptFor(
        {
          name: "도우미",
          purpose: "안내",
          instructions: "",
          terminology: [],
          sourceSelection: "all",
          sourceOriginalIds: [],
        },
        "배송 절차는?",
        mode,
        [source()],
        [],
        MIN_INPUT_TOKEN_LIMIT,
      );
      const bound = inputBound(prompt.instructions + prompt.input);
      expect(bound).toBeLessThanOrEqual(MIN_INPUT_TOKEN_LIMIT);
      expect(JSON.parse(prompt.input).sources[0].content).toBe(
        source().content,
      );
      expect(() =>
        promptFor(
          {
            name: "도우미",
            purpose: "안내",
            instructions: "",
            terminology: [],
            sourceSelection: "all",
            sourceOriginalIds: [],
          },
          "배송 절차는?",
          mode,
          [source()],
          [],
          bound - 1,
        ),
      ).toThrow("input_limit_exceeded");
    },
  );
  test("question metadata preserves exact text and canonicalizes UUIDs", () => {
    expect(
      questionInput({
        requestId: id.toUpperCase(),
        question: " 질문 원문 ",
        requestedMode: "auto",
      }),
    ).toEqual({
      requestId: id,
      question: " 질문 원문 ",
      requestedMode: "auto",
      historyRequestIds: [],
    });
  });
  test.each([
    { conversationId: null },
    { conversationId: "bad" },
    { historyRequestIds: [id] },
    { conversationId: id, historyRequestIds: [id, id.toUpperCase()] },
    { attachmentId: id },
    { requestedMode: "change_impact" },
    { question: "x".repeat(4001) },
  ])("rejects malformed/provenance-expanded requests", (extra) => {
    expect(() =>
      questionInput({
        requestId: id,
        question: "원문",
        requestedMode: "auto",
        ...extra,
      }),
    ).toThrow();
  });
  test.each([
    ["어느 문서에 있어?", "documentation_gap"],
    ["왜 변경했어?", "product_history"],
    ["how to install", "onboarding"],
    ["what changed", "product_history"],
    ["일반 질문", "onboarding"],
  ] as const)("resolves auto using explicit rules for %s", (question, mode) => {
    expect(resolvedMode("auto", question)).toBe(mode);
    expect(resolvedMode("documentation_gap", question)).toBe(
      "documentation_gap",
    );
  });
  test("uses raw similarity for answerability, not boosted rank", () => {
    expect(
      selectSources("onboarding", [
        source({ score: 0.1, knowledgeTypes: ["deployment"] }),
      ]).answerable,
    ).toBe(false);
    expect(selectSources("onboarding", [source()]).answerable).toBe(true);
    expect(
      selectSources("onboarding", [
        source({ score: 0.5 }),
        source({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", score: 0.1 }),
        source({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", score: 0.1 }),
      ]).answerable,
    ).toBe(false);
  });
  test("mode changes eligible sources and selected full chunks fit the evidence bound", () => {
    const histories = source({ knowledgeTypes: ["product_history"] });
    expect(selectSources("onboarding", [histories]).sources).toEqual([]);
    expect(selectSources("product_history", [histories]).sources).toHaveLength(
      1,
    );
    const a = source({ content: "a".repeat(4000) }),
      b = source({
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        content: "b".repeat(4000),
      });
    const selection = selectSources("onboarding", [a, b]);
    expect(selection.sources).toHaveLength(1);
    expect(selection.sources[0]!.content).toBe(a.content);
    expect(selection.omittedCount).toBe(1);
  });
  test("sends real source text with separate instructions and bounded explicit history", () => {
    const s = source(),
      config = {
        name: "도우미",
        purpose: "안내",
        instructions: "짧게",
        terminology: [],
        sourceSelection: "all" as const,
        sourceOriginalIds: [] as [],
      };
    const prompt = promptFor(
      config,
      "질문",
      "onboarding",
      [s],
      [{ question: "이전 질문", answer: "이전 답변" }],
      16000,
    );
    expect(JSON.parse(prompt.input).sources[0].content).toBe(s.content);
    expect(prompt.instructions).toContain("untrusted");
    expect(prompt.instructions).toContain("practical steps");
    expect(
      promptFor(config, "질문", "product_history", [s], [], 16000).instructions,
    ).toContain("chronology");
    expect(() =>
      promptFor(
        config,
        "질문",
        "onboarding",
        [s],
        [{ question: "x".repeat(16000), answer: "a" }],
        16000,
      ),
    ).toThrow("input_limit_exceeded");
  });
  test("accepts an exact quote tied to the selected source identity", () => {
    expect(parseGroundedResult(JSON.stringify(valid), [source()])).toEqual(
      valid,
    );
  });
  test.each([
    { ...valid, claims: [] },
    { ...valid, claims: [{ text: "추측", evidence: [] }] },
    {
      ...valid,
      claims: [
        { text: "추측", evidence: [{ sourceId: id, quote: "없는 문구" }] },
      ],
    },
    {
      ...valid,
      claims: [
        {
          text: "추측",
          evidence: [{ sourceId: "unknown", quote: "발송 절차" }],
        },
      ],
    },
    { ...valid, conflicts: valid.claims },
    { ...valid, isAnswerable: false },
  ])(
    "rejects fabricated references, unsupported quotes and incomplete/conflicting shapes",
    (value) => {
      expect(() =>
        parseGroundedResult(JSON.stringify(value), [source()]),
      ).toThrow("invalid_grounded_response");
    },
  );
  test("call identities remain stable across retries and differ by purpose", () => {
    expect(callId(id, "embedding")).toBe(callId(id, "embedding"));
    expect(callId(id, "embedding")).not.toBe(callId(id, "answer"));
    expect(callId(id, "answer")).toMatch(
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
    );
  });
  test("question body routing matches Express aliases and excludes unrelated routes", () => {
    for (const path of [
      "/rag/questions",
      "/RAG/QUESTIONS/",
      "/rag/questions?x=1",
    ])
      expect(isRagQuestion({ method: "POST", originalUrl: path })).toBe(true);
    for (const path of [
      "/rag/questions/other",
      "/rag/questions//",
      "/rag/question",
    ])
      expect(isRagQuestion({ method: "POST", originalUrl: path })).toBe(false);
    expect(
      isRagQuestion({ method: "PUT", originalUrl: "/rag/questions" }),
    ).toBe(false);
  });
});
