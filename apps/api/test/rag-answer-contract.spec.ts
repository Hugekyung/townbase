import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  answerText,
  GroundingError,
  GROUNDING_REJECTIONS,
  groundingDiagnostic,
  parseGroundedResult,
  parseRagAnswer,
  parseStoredRagResult,
  promptFor,
  RAG_INSUFFICIENT,
  RAG_PARTIAL_NOTICE,
  RAG_SCOPE_NOTICE,
  ragRefusal,
  type RagSource,
} from "../src/rag/rag-policy";
import {
  GROUNDED_FORMAT_INPUT,
  RAG_GROUNDED_FORMAT_INPUT,
} from "../src/model-integration/grounded-format";
import {
  inputBound,
  MIN_ANSWER_INPUT_TOKEN_LIMIT,
} from "../src/model-integration/model-policy";
import { OperationalLogger } from "../src/operations/operational-logger";

const DOC = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const uuid = (n: number) =>
  `${String(n).repeat(8).slice(0, 8)}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
type Part = { segment: number; start: number; end: number; page: number };
// Lines map 1:1 to parts, exactly as file-chunker writes current chunks.
const chunk = (
  n: number,
  lines: string[],
  parts: Part[] | null,
  originalId = DOC,
): RagSource => {
  const content = lines.join("\n");
  return {
    id: uuid(n),
    indexId: uuid(9),
    originalId,
    versionId: originalId,
    scopeRevision: 1,
    content,
    title: "행복주택 모집공고",
    fileName: "notice.pdf",
    format: "pdf",
    contentHash: "x",
    chunkHash: createHash("sha256").update(content).digest("hex"),
    locations: (parts ?? []).map((p) => ({
      segment: p.segment,
      start: p.start,
      end: p.end,
      location: { page: p.page },
      headingPath: [],
    })),
    headingPath: [],
    sourceType: "uploaded_file",
    knowledgeTypes: ["unknown"],
    domainTags: [],
    status: "active",
    sourcePriority: 50,
    requestedMode: null,
    resolvedMode: null,
    score: 0.8,
    reference: "/files/" + originalId + "/reference",
  };
};
const p16 = chunk(
  1,
  ["계약 장소는 본사 1층 접수처입니다.", "접수 시간은 오전 10시부터입니다."],
  [
    { segment: 15, start: 0, end: 19, page: 16 },
    { segment: 15, start: 20, end: 38, page: 16 },
  ],
);
const p17 = chunk(
  2,
  ["계약 장소는 지사 2층 회의실입니다.", "2번 출구로 나오십시오."],
  [
    { segment: 16, start: 0, end: 19, page: 17 },
    { segment: 16, start: 20, end: 33, page: 17 },
  ],
);
const claim = (text: string, ...evidence: [string, string][]) => ({
  text,
  evidence: evidence.map(([sourceId, quote]) => ({ sourceId, quote })),
});
const v2 = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    isAnswerable: true,
    reason: "",
    claims: [claim("계약 장소는 본사입니다.", ["S1", "본사 1층 접수처"])],
    conflicts: [],
    followUps: [],
    ...over,
  });
const rejection = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(GroundingError);
    expect((error as GroundingError).code).toBe("invalid_grounded_response");
    expect((error as GroundingError).status).toBe(502);
    return (error as GroundingError).detail;
  }
  throw new Error("expected a grounding rejection");
};

describe("R05 RAG v2 answer contract", () => {
  test("answerable v2 keeps S-number mapping and stores an explicit version", () => {
    const result = parseRagAnswer(v2(), [p16, p17]);
    expect(result).toEqual({
      contractVersion: 2,
      isAnswerable: true,
      reason: "",
      claims: [
        {
          text: "계약 장소는 본사입니다.",
          evidence: [{ sourceId: p16.id, quote: "본사 1층 접수처" }],
        },
      ],
      conflicts: [],
      followUps: [],
    });
  });

  test("a refusal keeps verified partial facts and separate follow-up items", () => {
    const result = parseRagAnswer(
      v2({
        isAnswerable: false,
        reason: "찾은 근거로는 소득 기준 충족 여부를 판단할 수 없습니다.",
        claims: [
          claim("접수는 오전 10시에 시작합니다.", ["S1", "오전 10시부터"]),
        ],
        followUps: ["세대 월평균 소득은 얼마인가요?", "무주택 여부"],
      }),
      [p16],
    );
    expect(result.isAnswerable).toBe(false);
    expect(result.claims).toHaveLength(1);
    expect(result.followUps).toEqual([
      "세대 월평균 소득은 얼마인가요?",
      "무주택 여부",
    ]);
    const text = answerText(result);
    expect(text.split("\n\n")).toEqual([
      "찾은 근거로는 소득 기준 충족 여부를 판단할 수 없습니다.",
      RAG_SCOPE_NOTICE,
      RAG_PARTIAL_NOTICE,
      `접수는 오전 10시에 시작합니다. [${p16.id}]`,
      "추가로 확인할 항목:\n- 세대 월평균 소득은 얼마인가요?\n- 무주택 여부",
    ]);
  });

  test("partial facts on a refusal still require exact quotes and real IDs", () => {
    const refused = (evidence: [string, string]) =>
      v2({
        isAnswerable: false,
        reason: "판단 불가",
        claims: [claim("사실", evidence)],
      });
    expect(
      rejection(() => parseRagAnswer(refused(["S1", "오전 11시부터"]), [p16])),
    ).toBe("quote_mismatch");
    expect(
      rejection(() => parseRagAnswer(refused(["S2", "오전 10시부터"]), [p16])),
    ).toBe("source_id");
  });

  test.each([
    ["answerable with follow-ups", { followUps: ["추가 질문"] }],
    ["answerable with a reason", { reason: "이유" }],
    ["answerable without claims", { claims: [] }],
    ["refusal without a reason", { isAnswerable: false, reason: " " }],
  ])("%s violates the answerability invariant", (_name, over) => {
    expect(rejection(() => parseRagAnswer(v2(over), [p16]))).toBe(
      "answerability",
    );
  });

  test.each([
    ["more than five", ["a", "b", "c", "d", "e", "f"]],
    ["too long", ["가".repeat(301)]],
    ["blank", ["  "]],
    ["multi-line", ["첫 줄\n둘째 줄"]],
    ["not a string", [3]],
  ])("follow-ups that are %s are rejected", (_name, followUps) => {
    expect(
      rejection(() =>
        parseRagAnswer(
          v2({
            isAnswerable: false,
            reason: "판단 불가",
            claims: [],
            followUps,
          }),
          [p16],
        ),
      ),
    ).toBe("follow_up");
  });

  test("each validation branch reports its own diagnostic independently", () => {
    expect(rejection(() => parseRagAnswer("{not json", [p16]))).toBe("json");
    expect(rejection(() => parseRagAnswer(undefined, [p16]))).toBe("json");
    const v1Shape = JSON.parse(v2()) as Record<string, unknown>;
    delete v1Shape.followUps;
    expect(
      rejection(() => parseRagAnswer(JSON.stringify(v1Shape), [p16])),
    ).toBe("schema");
    expect(
      rejection(() => parseRagAnswer(v2({ contractVersion: 2 }), [p16])),
    ).toBe("schema");
    expect(
      rejection(() =>
        parseRagAnswer(
          v2({ claims: [claim("사실", ["S3", "본사 1층 접수처"])] }),
          [p16],
        ),
      ),
    ).toBe("source_id");
    expect(
      rejection(() =>
        parseRagAnswer(
          v2({ claims: [claim("사실", ["S1", "본사 3층 접수처"])] }),
          [p16],
        ),
      ),
    ).toBe("quote_mismatch");
    expect(
      rejection(() =>
        parseRagAnswer(
          v2({
            conflicts: [
              claim(
                "장소 상충",
                ["S1", "본사 1층 접수처"],
                ["S1", "본사 1층 접수처"],
              ),
            ],
          }),
          [p16],
        ),
      ),
    ).toBe("conflict_evidence");
    expect(GROUNDING_REJECTIONS.map(groundingDiagnostic)).toEqual([
      "TOWNBASE_RAG_GROUNDING_JSON",
      "TOWNBASE_RAG_GROUNDING_SCHEMA",
      "TOWNBASE_RAG_GROUNDING_SOURCE_ID",
      "TOWNBASE_RAG_GROUNDING_QUOTE_MISMATCH",
      "TOWNBASE_RAG_GROUNDING_ANSWERABILITY",
      "TOWNBASE_RAG_GROUNDING_CONFLICT_EVIDENCE",
      "TOWNBASE_RAG_GROUNDING_FOLLOW_UP",
      "TOWNBASE_RAG_GROUNDING_QUOTE_PUNCTUATION",
      "TOWNBASE_RAG_GROUNDING_QUOTE_SPACING",
    ]);
  });
});

describe("R05 same-document conflicts", () => {
  const conflict = (...evidence: [string, string][]) =>
    v2({
      isAnswerable: false,
      reason: "공고 안에서 계약 장소가 서로 달라 확정할 수 없습니다.",
      claims: [],
      conflicts: [claim("계약 장소가 16쪽과 17쪽에서 다릅니다.", ...evidence)],
    });

  test("Q10: two pages of one PDF are two sides and remain unresolved", () => {
    const result = parseRagAnswer(
      conflict(["S1", "본사 1층 접수처"], ["S2", "지사 2층 회의실"]),
      [p16, p17],
    );
    expect(result.isAnswerable).toBe(false);
    expect(result.conflicts[0]!.evidence.map((e) => e.sourceId)).toEqual([
      p16.id,
      p17.id,
    ]);
    expect(answerText(result)).toContain("근거 간 충돌: ");
  });

  test("two different non-overlapping passages of one chunk are two sides", () => {
    expect(
      parseRagAnswer(
        conflict(["S1", "본사 1층 접수처"], ["S1", "오전 10시부터"]),
        [p16],
      ).conflicts,
    ).toHaveLength(1);
  });

  test("the same sentence cited twice is one side", () => {
    expect(
      rejection(() =>
        parseRagAnswer(
          conflict(["S1", "본사 1층 접수처"], ["S1", "1층 접수처"]),
          [p16],
        ),
      ),
    ).toBe("conflict_evidence");
  });

  test("overlapping excerpts of one passage in one chunk are one side", () => {
    expect(
      rejection(() =>
        parseRagAnswer(
          conflict(["S1", "계약 장소는 본사"], ["S1", "본사 1층 접수처입니다"]),
          [p16],
        ),
      ),
    ).toBe("conflict_evidence");
  });

  test("an overlapped unit repeated across chunks resolves to one passage", () => {
    const shared = { segment: 15, start: 20, end: 38, page: 16 };
    const next = chunk(
      3,
      ["접수 시간은 오전 10시부터입니다.", "서류는 원본만 받습니다."],
      [shared, { segment: 15, start: 39, end: 52, page: 16 }],
    );
    // Different text, same stored passage (part key) with overlapping ranges.
    expect(
      rejection(() =>
        parseRagAnswer(
          conflict(["S1", "접수 시간은 오전"], ["S2", "오전 10시부터입니다."]),
          [p16, next],
        ),
      ),
    ).toBe("conflict_evidence");
    // A different passage of the overlapping chunk is still a second side.
    expect(
      parseRagAnswer(
        conflict(["S1", "접수 시간은 오전"], ["S2", "서류는 원본만 받습니다."]),
        [p16, next],
      ).conflicts,
    ).toHaveLength(1);
  });

  test("identical wording at two different stored passages is two sides", () => {
    const a = chunk(
      6,
      ["해당 사항 없음으로 처리합니다."],
      [{ segment: 3, start: 0, end: 17, page: 4 }],
    );
    const b = chunk(
      7,
      ["해당 사항 없음으로 처리합니다."],
      [{ segment: 9, start: 0, end: 17, page: 9 }],
    );
    expect(
      parseRagAnswer(
        conflict(["S1", "해당 사항 없음"], ["S2", "없음으로 처리합니다."]),
        [a, b],
      ).conflicts,
    ).toHaveLength(1);
  });

  test("older chunk layouts without 1:1 parts fall back to the line text", () => {
    const a = chunk(4, ["가 기준은 140%입니다.", "다른 문장입니다."], null);
    const b = chunk(5, ["가 기준은 140%입니다."], null);
    expect(
      rejection(() =>
        parseRagAnswer(
          conflict(["S1", "가 기준은"], ["S2", "기준은 140%입니다."]),
          [a, b],
        ),
      ),
    ).toBe("conflict_evidence");
  });

  test("attachments keep the v1 rule that a conflict spans two documents", () => {
    const v1 = JSON.stringify({
      isAnswerable: false,
      reason: "충돌",
      claims: [],
      conflicts: [
        claim("상충", ["S1", "본사 1층 접수처"], ["S2", "지사 2층 회의실"]),
      ],
    });
    expect(() => parseGroundedResult(v1, [p16, p17], "prompt")).toThrow(
      "invalid_grounded_response",
    );
    const other = { ...p17, originalId: OTHER, versionId: OTHER };
    expect(
      parseGroundedResult(v1, [p16, other], "prompt").conflicts,
    ).toHaveLength(1);
  });
});

describe("R05 stored readback and prompt boundary", () => {
  test("stored v2 and pre-R05 v1 rows are read with their own rules", () => {
    const stored = parseRagAnswer(
      v2({
        isAnswerable: false,
        reason: "판단 불가",
        claims: [claim("접수는 오전 10시입니다.", ["S1", "오전 10시부터"])],
        followUps: ["소득 자료"],
      }),
      [p16],
    );
    const readback = parseStoredRagResult(JSON.stringify(stored), [p16]);
    expect(readback).toEqual(stored);
    expect(answerText(readback)).toBe(answerText(stored));

    const v1Row = {
      isAnswerable: false,
      reason: "근거 부족",
      claims: [],
      conflicts: [],
    };
    const v1 = parseStoredRagResult(JSON.stringify(v1Row), [p16]);
    expect(v1).toEqual(v1Row);
    expect(answerText(v1)).toBe("근거 부족");
    // v1 never allowed partial facts on a refusal; old rows are not reinterpreted.
    expect(
      rejection(() =>
        parseStoredRagResult(
          JSON.stringify({
            ...v1Row,
            claims: [claim("사실", [p16.id, "오전 10시부터"])],
          }),
          [p16],
        ),
      ),
    ).toBe("answerability");
  });

  test("stored rows with another version or a missing v2 field are rejected", () => {
    const base = JSON.parse(JSON.stringify(ragRefusal())) as Record<
      string,
      unknown
    >;
    expect(
      rejection(() =>
        parseStoredRagResult(
          JSON.stringify({ ...base, contractVersion: 3 }),
          [],
        ),
      ),
    ).toBe("schema");
    const missing = { ...base };
    delete missing.followUps;
    expect(
      rejection(() => parseStoredRagResult(JSON.stringify(missing), [])),
    ).toBe("schema");
    expect(parseStoredRagResult(JSON.stringify(base), [])).toEqual(
      ragRefusal(),
    );
  });

  test("no-evidence refusals say only the retrieved excerpts were insufficient", () => {
    expect(ragRefusal().reason).toBe(RAG_INSUFFICIENT);
    expect(RAG_INSUFFICIENT).toContain(
      "문서 전체에 해당 내용이 없다는 뜻은 아닙니다",
    );
    expect(answerText(ragRefusal())).toBe(RAG_INSUFFICIENT);
  });

  test("a model reason claiming whole-document absence still shows the server scope notice", () => {
    const result = parseRagAnswer(
      v2({
        isAnswerable: false,
        reason: "문서 전체에 계약 장소 정보가 없습니다.",
        claims: [],
      }),
      [p16],
    );
    // The model's wording is kept as-is; the fixed server notice follows it.
    expect(result.reason).toBe("문서 전체에 계약 장소 정보가 없습니다.");
    expect(answerText(result).split("\n\n")).toEqual([
      "문서 전체에 계약 장소 정보가 없습니다.",
      RAG_SCOPE_NOTICE,
    ]);
    expect(RAG_SCOPE_NOTICE).toContain(
      "문서 전체에 해당 내용이 없다는 뜻은 아닙니다",
    );
    // Answered results and v1 rows are unchanged.
    expect(answerText(parseRagAnswer(v2(), [p16]))).not.toContain(
      RAG_SCOPE_NOTICE,
    );
    expect(
      answerText({
        isAnswerable: false,
        reason: "근거 부족",
        claims: [],
        conflicts: [],
      }),
    ).toBe("근거 부족");
  });

  test("RAG prompts count the v2 schema; the default attachment prompt is unchanged", () => {
    const config = {
      name: "도우미",
      purpose: "안내",
      instructions: "",
      terminology: [],
      sourceSelection: "all" as const,
      sourceOriginalIds: [] as [],
    };
    const rag = promptFor(
      config,
      "장소는?",
      "onboarding",
      [p16],
      [],
      16000,
      "rag_v2",
    );
    const attachment = promptFor(
      config,
      "장소는?",
      "onboarding",
      [p16],
      [],
      16000,
    );
    expect(rag.instructions).toContain("followUps");
    expect(attachment.instructions).not.toContain("followUps");
    // R07 Q13: only RAG v2 carries the list-scope (exception list) rule.
    expect(rag.instructions).toContain("List scope:");
    expect(rag.instructions).toContain("they are NOT requirements");
    expect(attachment.instructions).not.toContain("List scope:");
    expect(attachment.input).toBe(rag.input);
    const bound = inputBound(
      rag.instructions + rag.input + RAG_GROUNDED_FORMAT_INPUT,
    );
    expect(bound).toBeGreaterThan(
      inputBound(rag.instructions + rag.input + GROUNDED_FORMAT_INPUT),
    );
    expect(() =>
      promptFor(
        config,
        "장소는?",
        "onboarding",
        [p16],
        [],
        bound - 1,
        "rag_v2",
      ),
    ).toThrow("input_limit_exceeded");
  });
});

describe("R05 minimum input setting", () => {
  test.each(["onboarding", "product_history", "documentation_gap"] as const)(
    "the minimum allowed input setting admits a short sourced %s RAG v2 prompt with its schema",
    (mode) => {
      const config = {
        name: "도우미",
        purpose: "안내",
        instructions: "",
        terminology: [],
        sourceSelection: "all" as const,
        sourceOriginalIds: [] as [],
      };
      const short = { ...p16, content: "배송은 주문 확인 후 진행합니다." };
      const prompt = promptFor(
        config,
        "배송 절차는?",
        mode,
        [short],
        [],
        MIN_ANSWER_INPUT_TOKEN_LIMIT,
        "rag_v2",
      );
      expect(
        inputBound(
          prompt.instructions + prompt.input + RAG_GROUNDED_FORMAT_INPUT,
        ),
      ).toBeLessThanOrEqual(MIN_ANSWER_INPUT_TOKEN_LIMIT);
    },
  );
});

// R07 first-use run: every failure was quote_mismatch. Extracted PDF lines keep
// visual wraps inside sentences, and the model copied them as a space or as
// nothing. Only whitespace may differ; the stored quote is the exact source span.
describe("R07 quote whitespace tolerance", () => {
  const wrapped = chunk(
    3,
    [
      "※ 출산자녀는 ’23.",
      "3.",
      "28 이후 출산한 자녀(입양자녀 및 태아 포함)를 의미하며, 기준일 이후 출산 자녀가 있는 경우",
      "에는 기준일 이전 출생한 기존 미성년자녀도 포함하여 최대 2자녀로 인정",
      "총 1",
      "2명 모집",
      "‧ 방문접수(우편접수 불가)",
    ],
    [0, 1, 2, 3, 4, 5, 6].map((i) => ({
      segment: 40,
      start: i * 100,
      end: i * 100 + 50,
      page: 7,
    })),
  );
  const answer = (quote: string) =>
    v2({ claims: [claim("사실", ["S1", quote])] });
  test.each([
    [
      "a wrapped date copied with spaces",
      "’23. 3. 28 이후 출산한 자녀",
      "’23.\n3.\n28 이후 출산한 자녀",
    ],
    [
      "a wrapped date copied without spaces",
      "’23.3.28 이후",
      "’23.\n3.\n28 이후",
    ],
    [
      "a word split across lines copied joined",
      "출산 자녀가 있는 경우에는 기준일 이전 출생한 기존 미성년자녀도 포함",
      "출산 자녀가 있는 경우\n에는 기준일 이전 출생한 기존 미성년자녀도 포함",
    ],
    [
      "extra spaces and surrounding whitespace",
      "  최대  2자녀로 인정 ",
      "최대 2자녀로 인정",
    ],
  ])(
    "%s is verified and stored as the exact source text",
    (_n, quote, stored) => {
      const result = parseRagAnswer(answer(quote), [wrapped]);
      expect(result.claims[0]!.evidence).toEqual([
        { sourceId: wrapped.id, quote: stored },
      ]);
      expect(wrapped.content).toContain(stored);
      // Readback re-verifies the stored span exactly.
      const readback = parseStoredRagResult(JSON.stringify(result), [wrapped]);
      expect(readback.claims[0]!.evidence[0]!.quote).toBe(stored);
    },
  );
  test.each([
    ["digits joined across a wrap", "총 12명 모집", "quote_spacing"],
    ["a space inserted between digits", "’2 3.", "quote_spacing"],
    ["a changed date", "’23. 3. 29 이후 출산한 자녀", "quote_mismatch"],
    ["a changed count", "최대 3자녀로 인정", "quote_mismatch"],
    [
      "a replaced bullet glyph",
      "· 방문접수(우편접수 불가)",
      "quote_punctuation",
    ],
    ["changed brackets", "방문접수[우편접수 불가]", "quote_punctuation"],
  ])("%s is still rejected with its own diagnostic", (_n, quote, detail) => {
    expect(rejection(() => parseRagAnswer(answer(quote), [wrapped]))).toBe(
      detail,
    );
  });
  test("joined nonadjacent pieces are each matched with whitespace tolerance", () => {
    const result = parseRagAnswer(
      answer("’23. 3. 28 이후 출산한 자녀\n방문접수(우편접수 불가)"),
      [wrapped],
    );
    // Not one contiguous span, so it falls back to ordered exact pieces.
    expect(result.claims[0]!.evidence.map((e) => e.quote)).toEqual([
      "’23.\n3.\n28 이후 출산한 자녀",
      "방문접수(우편접수 불가)",
    ]);
  });
  test("stored readback accepts only the exact persisted span", () => {
    const spaced = "’23. 3. 28 이후 출산한 자녀";
    const stored = (contract: Record<string, unknown>) =>
      JSON.stringify({
        ...contract,
        isAnswerable: true,
        reason: "",
        claims: [
          { text: "사실", evidence: [{ sourceId: wrapped.id, quote: spaced }] },
        ],
        conflicts: [],
      });
    expect(
      rejection(() =>
        parseStoredRagResult(stored({ contractVersion: 2, followUps: [] }), [
          wrapped,
        ]),
      ),
    ).toBe("quote_spacing");
    // Stored v1 rows (old RAG and attachment readback) are strict as well.
    expect(rejection(() => parseGroundedResult(stored({}), [wrapped]))).toBe(
      "quote_spacing",
    );
  });
  test("an earlier whitespace-tolerant match is used when a later exact one would block the next piece", () => {
    const layout = chunk(
      4,
      [
        "가나다 기준일",
        "이전 출생한 자녀 인정",
        "기타 안내",
        "방문접수(우편접수 불가)",
        "기준일 이전 출생한 자녀 인정",
      ],
      [0, 1, 2, 3, 4].map((i) => ({
        segment: 41,
        start: i * 100,
        end: i * 100 + 50,
        page: 8,
      })),
    );
    const result = parseRagAnswer(
      answer("기준일 이전 출생한 자녀 인정\n방문접수(우편접수 불가)"),
      [layout],
    );
    expect(result.claims[0]!.evidence.map((e) => e.quote)).toEqual([
      "기준일\n이전 출생한 자녀 인정",
      "방문접수(우편접수 불가)",
    ]);
  });
  test("the attachment v1 contract uses the same whitespace-only rule", () => {
    const v1 = parseGroundedResult(
      JSON.stringify({
        isAnswerable: true,
        reason: "",
        claims: [claim("사실", ["S1", "있는 경우에는 기준일"])],
        conflicts: [],
      }),
      [wrapped],
      "prompt",
    );
    expect(v1.claims[0]!.evidence[0]!.quote).toBe("있는 경우\n에는 기준일");
  });
});

describe("R05 grounding diagnostics", () => {
  const before = process.env.TOWNBASE_OPERATIONS_PATH;
  let root: string;
  beforeEach(async () => {
    root = await realpath(
      await mkdtemp(path.join(os.tmpdir(), "townbase-r05-")),
    );
    process.env.TOWNBASE_OPERATIONS_PATH = root;
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    if (before == null) delete process.env.TOWNBASE_OPERATIONS_PATH;
    else process.env.TOWNBASE_OPERATIONS_PATH = before;
  });
  test("every grounding branch code is persisted as an allowed fixed code", async () => {
    const log = new OperationalLogger();
    for (const detail of GROUNDING_REJECTIONS)
      log.warn(groundingDiagnostic(detail));
    log.warn("TOWNBASE_RAG_GROUNDING_PROVIDER_TEXT_CANARY");
    const dir = path.join(root, "diagnostics");
    const text = await readFile(
      path.join(dir, (await readdir(dir))[0]!),
      "utf8",
    );
    expect(
      text
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line).code),
    ).toEqual([
      ...GROUNDING_REJECTIONS.map(groundingDiagnostic),
      "TOWNBASE_APPLICATION_ERROR",
    ]);
  });
});
