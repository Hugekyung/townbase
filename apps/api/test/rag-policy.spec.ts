import { createHash } from "node:crypto";
import {
  questionInput,
  lexicalEvidence,
  exactExcerpts,
  resolvedMode,
  selectSources,
  promptFor,
  parseGroundedResult,
  callId,
  type RagSource,
  evidenceContent,
  promptSources,
} from "../src/rag/rag-policy";
import { isRagQuestion } from "../src/rag/rag-http";
import { savedSources } from "../src/rag/rag-store";
import {
  MIN_ANSWER_INPUT_TOKEN_LIMIT,
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
test("stored source windows survive JSON readback and reject invalid ranges", () => {
  const s = { ...source(), evidenceWindow: { start: 0, end: 5 } };
  const restored = savedSources(JSON.parse(JSON.stringify([s])));
  expect(evidenceContent(restored[0]!)).toBe(s.content.slice(0, 5));
  expect(() =>
    savedSources(
      JSON.parse(
        JSON.stringify([{ ...s, evidenceWindow: { start: -1, end: 5 } }]),
      ),
    ),
  ).toThrow();
  expect(() =>
    savedSources(
      JSON.parse(
        JSON.stringify([
          { ...s, evidenceWindow: { start: 0, end: s.content.length + 1 } },
        ]),
      ),
    ),
  ).toThrow();
  expect(
    evidenceContent(savedSources(JSON.parse(JSON.stringify([source()])))[0]!),
  ).toBe(source().content);
});
test("packs multiple exact evidence windows within the actual 8KB prompt envelope", () => {
  const text =
    "머리말 고유 문장입니다. " +
    "일반 안내입니다. ".repeat(90) +
    "청약통장은 입주 전까지 가입해야 합니다. " +
    "별도 안내입니다. ".repeat(90);
  const rows = Array.from({ length: 5 }, (_, i) =>
    source({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      content: text,
      score: 0.7,
      vectorRank: i + 1,
      lexicalRank: i + 1,
    }),
  );
  const selected = selectSources(
    "onboarding",
    rows,
    "청약통장은 입주 전까지 가입해야 해?",
  );
  expect(selected.sources.length).toBeGreaterThan(1);
  expect(
    Buffer.byteLength(JSON.stringify(promptSources(selected.sources))),
  ).toBeLessThanOrEqual(8000);
  for (const s of selected.sources) {
    expect(s.content).toBe(text);
    expect(evidenceContent(s)).toContain(
      "청약통장은 입주 전까지 가입해야 합니다.",
    );
  }
  // R04-b: the top-ranked source is sent whole; later ones stay windowed.
  expect(selected.sources[0]!.evidenceWindow).toBeUndefined();
  expect(evidenceContent(selected.sources[0]!)).toBe(text);
  const s = selected.sources[1]!;
  expect(s.evidenceWindow!.start).toBeGreaterThan(400);
  // The same quote is valid against the whole top source.
  expect(
    parseGroundedResult(
      JSON.stringify({
        ...valid,
        claims: [
          {
            text: "설명",
            evidence: [
              {
                sourceId: selected.sources[0]!.id,
                quote: "머리말 고유 문장입니다.",
              },
            ],
          },
        ],
      }),
      [selected.sources[0]!],
    ).claims,
  ).toHaveLength(1);
  expect(() =>
    parseGroundedResult(
      JSON.stringify({
        ...valid,
        claims: [
          {
            text: "설명",
            evidence: [{ sourceId: s.id, quote: "머리말 고유 문장입니다." }],
          },
        ],
      }),
      [s],
    ),
  ).toThrow();
  expect(selected.diagnostics.length).toBe(5);
});
test("independent lexical candidates survive low cosine and the legacy mode topK cut", () => {
  const unrelated = Array.from({ length: 20 }, (_, i) =>
    source({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      content: "일반 임대 안내",
      score: 0.5,
      vectorRank: i + 1,
    }),
  );
  const exact = source({
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    content: "실제 근무지는 재직증명서로 확인합니다.",
    score: 0.1,
    lexicalRank: 1,
  });
  const result = selectSources(
    "onboarding",
    [...unrelated, exact],
    "실제 근무지는 재직증명서로 확인해?",
  );
  expect(result.sources.some((s) => s.id === exact.id)).toBe(true);
  expect(result.answerable).toBe(true);
});
test("short Korean field names can retrieve direct textual evidence without lowering the raw semantic gate", () => {
  const explicit = source({
    content: "지각 연락 대상: 운영 담당.",
    score: 0.33,
  });
  expect(selectSources("onboarding", [explicit]).answerable).toBe(false);
  expect(
    selectSources("onboarding", [explicit], "지각 연락 대상 알려줘.")
      .answerable,
  ).toBe(true);
  expect(lexicalEvidence("연말 보너스 지급일 알려줘.", explicit)).toBe(false);
  expect(
    lexicalEvidence("지각 연락 대상 알려줘.", { ...explicit, score: 0.24 }),
  ).toBe(true);
  expect(
    lexicalEvidence(
      "지각 연락 대상 알려줘.",
      source({
        content: "지각 문제와 연락 방법을 확인합니다. 대상은 운영팀입니다.",
        score: 0.24,
      }),
    ),
  ).toBe(false);
  expect(lexicalEvidence("알려줘 주세요", explicit)).toBe(false);
});
test("nonadjacent evidence is rendered as exact ordered excerpts without inventing or dropping facts", () => {
  const content =
    "현행 문서의 상태입니다. 중간 문단은 그대로 보존합니다. 비용은 3,000원입니다.";
  expect(
    exactExcerpts("현행 문서의 상태입니다. 비용은 3,000원입니다.", content),
  ).toEqual(["현행 문서의 상태입니다.", "비용은 3,000원입니다."]);
  expect(
    exactExcerpts("현행 문서의 상태입니다. 비용은 5,000원입니다.", content),
  ).toBeNull();
  expect(
    exactExcerpts("비용은 3,000원입니다. 현행 문서의 상태입니다.", content),
  ).toBeNull();
  expect(
    exactExcerpts("문서에 없는 주장입니다. 비용은 3,000원입니다.", content),
  ).toBeNull();
});
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
        MIN_ANSWER_INPUT_TOKEN_LIMIT,
      );
      const bound = inputBound(prompt.instructions + prompt.input);
      expect(bound).toBeLessThanOrEqual(MIN_ANSWER_INPUT_TOKEN_LIMIT);
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
  test("short prompt references map only to current sources and stored results keep UUIDs", () => {
    const s = source();
    const value = {
      ...valid,
      claims: [
        { text: "사실", evidence: [{ sourceId: "S1", quote: s.content }] },
      ],
    };
    expect(
      parseGroundedResult(JSON.stringify(value), [s], "prompt").claims[0]!
        .evidence[0]!.sourceId,
    ).toBe(s.id);
    expect(() => parseGroundedResult(JSON.stringify(value), [s])).toThrow();
    expect(() =>
      parseGroundedResult(JSON.stringify(valid), [s], "prompt"),
    ).toThrow();
    value.claims[0]!.evidence[0]!.sourceId = "S2";
    expect(() =>
      parseGroundedResult(JSON.stringify(value), [s], "prompt"),
    ).toThrow();
    expect(
      JSON.parse(
        promptFor(
          {
            name: "도우미",
            purpose: "안내",
            instructions: "",
            terminology: [],
            sourceSelection: "all",
            sourceOriginalIds: [],
          },
          "질문",
          "onboarding",
          [s],
          [],
          16000,
        ).input,
      ).sources[0].id,
    ).toBe("S1");
  });
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
// R07 retrieval diagnosis: in a small index nearly every chunk is in both the
// semantic and lexical lists, so reciprocal-rank fusion put the strongest
// lexical-only match (1/61) below mediocre both-list chunks, and the 8KB budget
// was spent before it was reached (Q05/Q09/Q10/Q04/Q14 of the housing notice).
describe("R07 evidence selection keeps the strongest lexical match", () => {
  const uid = (n: number) =>
    `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const filler = (n: number, rank: number) =>
    source({
      id: uid(n),
      content: Array.from(
        { length: 80 },
        (_, i) => `일반 안내 문장 ${n}-${i}번입니다.`,
      ).join("\n"),
      score: 0.5,
      vectorRank: rank,
      lexicalRank: rank + 1,
    });
  const question = "우편접수도 가능해? 접수 장소는 어디야?";
  const target = (overrides: Partial<RagSource> = {}) =>
    source({
      id: uid(9),
      content:
        "■ 신청접수\n방문접수(우편접수 불가) 접수 장소는 본관 지하 회의실입니다.\n접수 시간은 10시부터 17시까지입니다.",
      score: 0.3,
      vectorRank: null,
      lexicalRank: 1,
      ...overrides,
    });
  test("a lexical-only rank-1 match that passes the lexical gate is not cut for budget", () => {
    const candidates = [1, 2, 3, 4].map((n) => filler(n, n));
    const selection = selectSources(
      "onboarding",
      [...candidates, target()],
      question,
    );
    const ids = selection.sources.map((s) => s.id);
    // The top fused source stays first; the lexical lead is considered next.
    expect(ids[0]).toBe(uid(1));
    expect(ids[1]).toBe(uid(9));
    expect(evidenceContent(selection.sources[1]!)).toContain(
      "방문접수(우편접수 불가)",
    );
    expect(selection.diagnostics.find((d) => d.id === uid(9))!.decision).toBe(
      "selected",
    );
    expect(selection.evidenceBytes).toBeLessThanOrEqual(8000);
    expect(selection.sources.length).toBeLessThanOrEqual(5);
  });
  test("smaller initial windows admit more distinct sources before growth", () => {
    const candidates = [1, 2, 3, 4, 5].map((n) => filler(n, n));
    const selection = selectSources("onboarding", candidates, "일반 안내 문장");
    // A whole top chunk plus 1,800-byte windows left room for only three.
    expect(selection.sources.length).toBeGreaterThanOrEqual(4);
    expect(selection.evidenceBytes).toBeLessThanOrEqual(8000);
  });
  test("a top source too large to go whole keeps the 1,800-byte initial window", () => {
    // Over 8KB, so the top source is windowed. With 1,800 bytes the window is
    // the matching line plus the 1,400-byte next line; with 1,000 bytes it
    // would be the 600-byte previous line instead, and the 6,000-byte second
    // source leaves too little budget for growth to add the next line later.
    const top = source({
      id: uid(1),
      content: [
        "a".repeat(2500),
        "a".repeat(2500),
        "p".repeat(600),
        "우편접수 장소 안내",
        "n".repeat(1400),
        "z".repeat(2500),
      ].join("\n"),
      score: 0.9,
      vectorRank: 1,
      lexicalRank: 1,
    });
    const other = source({
      id: uid(2),
      content: "o".repeat(6000),
      score: 0.5,
      vectorRank: 2,
      lexicalRank: null,
    });
    const selection = selectSources(
      "onboarding",
      [top, other],
      "우편접수 장소는?",
    );
    expect(selection.sources.map((s) => s.id)).toEqual([uid(1), uid(2)]);
    const window = evidenceContent(selection.sources[0]!);
    expect(window).toBe("우편접수 장소 안내\n" + "n".repeat(1400) + "\n");
    expect(Buffer.byteLength(window)).toBeGreaterThan(1000);
    expect(Buffer.byteLength(window)).toBeLessThanOrEqual(1800);
  });
  test("a lexical rank alone does not bypass the gates", () => {
    const weak = target({
      content: "본관 지하에는 회의실이 있습니다.",
      lexicalRank: 1,
    });
    const selection = selectSources(
      "onboarding",
      [1, 2, 3].map((n) => filler(n, n)).concat(weak),
      question,
    );
    expect(selection.sources.map((s) => s.id)).not.toContain(uid(9));
    expect(selection.diagnostics.find((d) => d.id === uid(9))!.decision).toBe(
      "threshold",
    );
  });
});
