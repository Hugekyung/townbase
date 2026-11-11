import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import type { FileExtractor as ExtractorType } from "../src/files/file-extractor";
import {
  itemSeparator,
  pdfRules,
  pdfTables,
  streamText,
  type PdfTextItem,
} from "../src/files/pdf-table";
import {
  selectSources,
  promptSources,
  promptLocations,
  evidenceContent,
  type RagSource,
} from "../src/rag/rag-policy";
import { drawnPdf } from "./file-fixtures";

// The real production child and PDF.js, as emitted by the API build.
const { FileExtractor } = createRequire(__filename)(
  "../dist/files/file-extractor",
) as { FileExtractor: typeof ExtractorType };

// Grid: columns 50|120|190|260|330|400, rows 700|685|670|655|640|625.
// Row 0-1 header: Type / Group / Rent span both rows; "Deposit (KRW 1000)"
// spans two columns over Total / Down. "18" spans data rows 2-3.
const rules = [
  "50 625 350 75 re S", // outer frame (rectangle edges)
  "50 670 m 400 670 l S",
  "190 685 m 330 685 l S", // only under the two-column parent header
  "120 655 m 400 655 l S", // missing under "18" -> merged rows
  "q 1 0 0 1 10 0 cm 40 640 m 390 640 l S Q", // shifted into place by cm
  "120 625 m 120 700 l S",
  "190 625 m 190 700 l S",
  "259.75 625 0.5 60 re f", // thin filled rule, row 1 down only
  "330 625 m 330 700 l S",
  "0.9 g 191 671 68 13 re f 0 g", // background fill, not a rule
];
const header = [
  { x: 55, y: 680, text: "Type" },
  { x: 125, y: 680, text: "Group" },
  { x: 195, y: 690, text: "Deposit (KRW 1000)" },
  { x: 195, y: 674, text: "Total" },
  { x: 265, y: 674, text: "Down" },
  { x: 335, y: 680, text: "Rent (KRW)" },
];
const body = (row3: Array<{ x: number; y: number; text: string }>) => [
  { x: 50, y: 730, text: "Before table" },
  ...header,
  { x: 55, y: 656, text: "18" },
  { x: 125, y: 659, text: "Student" },
  { x: 195, y: 659, text: "21062" },
  { x: 265, y: 659, text: "4212" },
  { x: 335, y: 659, text: "87600" },
  { x: 125, y: 644, text: "Youth" },
  ...row3,
  { x: 335, y: 644, text: "92800" },
  { x: 55, y: 629, text: "21A" },
  { x: 125, y: 629, text: "Senior" },
  { x: 195, y: 629, text: "24096" },
  { x: 265, y: 629, text: "4819" },
  { x: 335, y: 629, text: "100300" },
  { x: 50, y: 600, text: "After table" },
];
const separate = [
  { x: 195, y: 644, text: "22302" },
  { x: 265, y: 644, text: "4460" },
];
const rows = [
  "Type: 18 | Group: Student | Deposit (KRW 1000) — Total: 21062, Down: 4212 | Rent (KRW): 87600",
  "Type: 18 | Group: Youth | Deposit (KRW 1000) — Total: 22302, Down: 4460 | Rent (KRW): 92800",
  "Type: 21A | Group: Senior | Deposit (KRW 1000) — Total: 24096, Down: 4819 | Rent (KRW): 100300",
];
const chars = (t: string) => [...t.replace(/\s+/gu, "")].sort().join("");

describe("R04-b ruled PDF tables through the real parser", () => {
  let extractor: ExtractorType;
  beforeEach(() => {
    extractor = new FileExtractor();
  });
  test("headers, parent units and merged rows are attached to every value in place", async () => {
    const result = await extractor.extract(
      "table.pdf",
      drawnPdf(body(separate), rules),
    );
    const text = result.segments[0]!.text;
    expect(text.split("\n")).toEqual(["Before table", ...rows, "After table"]);
    expect(result.segments[0]!.location).toEqual({ page: 1 });
    // Header text is repeated per row, but nothing from the page is dropped.
    const raw = await extractor.extract("raw.pdf", drawnPdf(body(separate)));
    for (const ch of chars(raw.segments[0]!.text)) expect(text).toContain(ch);
  }, 20000);
  test("one run crossing a border is split only when each word clearly sits in a cell", async () => {
    const result = await extractor.extract(
      "split.pdf",
      drawnPdf(body([{ x: 228, y: 644, text: "22302        4460" }]), rules),
    );
    expect(result.segments[0]!.text.split("\n")).toEqual([
      "Before table",
      ...rows,
      "After table",
    ]);
  }, 20000);
  test.each([
    ["no word gap", "2230244600"],
    // "4460" is drawn across the border at 260; its estimated centre is
    // inside one cell but within the 3pt safety margin.
    ["a word straddling the border", "22302 4460"],
  ])(
    "a run across cells with %s keeps the original text order instead of guessing",
    async (_name, text) => {
      const run = [{ x: 228, y: 644, text }];
      const ruled = await extractor.extract(
        "ambiguous.pdf",
        drawnPdf(body(run), rules),
      );
      const plain = await extractor.extract("plain.pdf", drawnPdf(body(run)));
      expect(ruled.segments[0]!.text).not.toContain(" | ");
      expect(ruled.segments[0]!.text).toBe(plain.segments[0]!.text);
    },
    20000,
  );
  test("borderless text is unchanged and a text-only ruled table keeps cell grouping", async () => {
    const plain = await extractor.extract(
      "plain.pdf",
      drawnPdf(body(separate)),
    );
    expect(plain.segments[0]!.text).not.toContain(" | ");
    const words = await extractor.extract(
      "words.pdf",
      drawnPdf(
        [
          { x: 55, y: 690, text: "Rank" },
          { x: 125, y: 690, text: "Rule" },
          { x: 55, y: 675, text: "First" },
          { x: 125, y: 675, text: "Local residents" },
        ],
        ["50 670 200 30 re S", "50 685 m 250 685 l S", "120 670 m 120 700 l S"],
      ),
    );
    expect(words.segments[0]!.text.split("\n")).toEqual([
      "Rank | Rule",
      "First | Local residents",
    ]);
  }, 20000);
  test("rotated text inside the frame keeps the original order; rotated text outside does not block", async () => {
    const rotated = (x: number, y: number) => [
      ...body(separate),
      {
        x,
        y,
        text: "Note",
        matrix: [0, 1, -1, 0] as [number, number, number, number],
      },
    ];
    const inside = await extractor.extract(
      "rotated.pdf",
      drawnPdf(rotated(345, 630), rules),
    );
    const plain = await extractor.extract(
      "plain.pdf",
      drawnPdf(rotated(345, 630)),
    );
    expect(inside.segments[0]!.text).not.toContain(" | ");
    expect(inside.segments[0]!.text).toBe(plain.segments[0]!.text);
    const outside = await extractor.extract(
      "rotated-outside.pdf",
      drawnPdf(rotated(520, 500), rules),
    );
    expect(outside.segments[0]!.text.split("\n")).toEqual(
      expect.arrayContaining(rows),
    );
  }, 20000);
});

describe("R04-b rule extraction and certainty checks", () => {
  const OPS = {
    save: 10,
    restore: 11,
    transform: 12,
    constructPath: 91,
    stroke: [20],
    fill: [22],
  };
  const path = (paint: number, ...data: number[]) => [
    paint,
    [Float32Array.from(data)],
    null,
  ];
  test("stroked edges, thin fills and transforms become rules; clips and backgrounds do not", () => {
    const rules = pdfRules(
      [10, 12, 91, 11, 91, 91, 91],
      [
        null,
        [1, 0, 0, 1, 5, 0],
        path(20, 0, 0, 0, 1, 100, 0), // shifted horizontal
        null,
        path(22, 0, 0, 10, 1, 0.5, 10, 1, 0.5, 90, 1, 0, 90, 4), // thin fill
        path(22, 0, 0, 0, 1, 60, 0, 1, 60, 40, 1, 0, 40, 4), // background
        path(28, 0, 0, 0, 1, 0, 100), // clip/end path
      ],
      OPS,
    );
    expect(rules).toEqual({
      horizontal: [{ at: 0, from: 5, to: 105 }],
      vertical: [{ at: 0.25, from: 10, to: 90 }],
    });
    expect(pdfRules([91], [path(20, 0, 0, 0, 9, 1, 1)], OPS)).toBeNull();
  });
  test("a line after a curve consumes its coordinates and keeps later rules aligned", () => {
    // moveTo, curveTo, lineTo(50,50) with no open path, then a real rule.
    expect(
      pdfRules(
        [91],
        [
          path(
            20,
            0,
            0,
            0,
            2,
            1,
            1,
            2,
            2,
            3,
            3,
            1,
            50,
            50,
            0,
            0,
            10,
            1,
            100,
            10,
          ),
        ],
        OPS,
      ),
    ).toEqual({ horizontal: [{ at: 10, from: 0, to: 100 }], vertical: [] });
  });
  test("without a header, a vertically merged cell repeats on every row it spans", () => {
    // Left column rows 1-2 merge; no numeric row, so no header is chosen.
    const rules = {
      horizontal: [
        { at: 30, from: 0, to: 40 },
        { at: 20, from: 0, to: 40 },
        { at: 10, from: 20, to: 40 },
        { at: 0, from: 0, to: 40 },
      ],
      vertical: [
        { at: 0, from: 0, to: 30 },
        { at: 20, from: 0, to: 30 },
        { at: 40, from: 0, to: 30 },
      ],
    };
    const item = (index: number, x: number, y: number, str: string) =>
      ({ index, str, x, y, width: 6, height: 4, upright: true }) as PdfTextItem;
    expect(
      pdfTables(rules, [
        item(0, 2, 23, "Rank"),
        item(1, 22, 23, "Rule"),
        item(2, 2, 8, "First"),
        item(3, 22, 13, "Local"),
        item(4, 22, 3, "Family"),
      ]).map((t) => t.lines),
    ).toEqual([["Rank | Rule", "First | Local", "First | Family"]]);
  });
  test("a numeric-looking header row under a spanning header cell stays a header", () => {
    // Size spans header rows 0-1; Income spans the 100%/120% header row.
    const rules = {
      horizontal: [
        { at: 30, from: 0, to: 60 },
        { at: 20, from: 20, to: 60 },
        { at: 10, from: 0, to: 60 },
        { at: 0, from: 0, to: 60 },
      ],
      vertical: [
        { at: 0, from: 0, to: 30 },
        { at: 20, from: 0, to: 30 },
        { at: 40, from: 0, to: 20 },
        { at: 60, from: 0, to: 30 },
      ],
    };
    const item = (index: number, x: number, y: number, str: string) =>
      ({ index, str, x, y, width: 6, height: 4, upright: true }) as PdfTextItem;
    expect(
      pdfTables(rules, [
        item(0, 2, 18, "Size"),
        item(1, 22, 23, "Income"),
        item(2, 22, 13, "100%"),
        item(3, 42, 13, "120%"),
        item(4, 2, 3, "2"),
        item(5, 22, 3, "645"),
        item(6, 42, 3, "703"),
      ]).map((t) => t.lines),
    ).toEqual([["Size: 2 | Income — 100%: 645, 120%: 703"]]);
  });
  test("a non-rectangular merged region is not rebuilt", () => {
    // 2x2 grid where three units merge into an L; certainty fails.
    const rules = {
      horizontal: [
        { at: 20, from: 0, to: 20 },
        { at: 10, from: 10, to: 20 },
        { at: 0, from: 0, to: 20 },
      ],
      vertical: [
        { at: 0, from: 0, to: 20 },
        { at: 10, from: 0, to: 10 },
        { at: 20, from: 0, to: 20 },
      ],
    };
    const item = (index: number, x: number, y: number, str: string) =>
      ({ index, str, x, y, width: 4, height: 4, upright: true }) as PdfTextItem;
    expect(
      pdfTables(rules, [item(0, 2, 13, "1"), item(1, 13, 3, "2")]),
    ).toEqual([]);
  });
});

describe("R04-b evidence delivery for table-heavy chunks", () => {
  const source = (
    n: number,
    lines: string[],
    pages: number[],
    rank: number,
  ): RagSource => {
    const content = lines.join("\n");
    return {
      id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
      indexId: "i",
      originalId: "o",
      versionId: "v",
      scopeRevision: 1,
      content,
      title: "공고",
      fileName: "n.pdf",
      format: "pdf",
      contentHash: "x",
      chunkHash: createHash("sha256").update(content).digest("hex"),
      locations: lines.map((line, i) => ({
        segment: pages[i]! - 1,
        start: i * 10,
        end: i * 10 + line.length,
        location: { page: pages[i]! },
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
      score: 0.7,
      vectorRank: rank,
      lexicalRank: rank,
      reference: "r",
    };
  };
  test("per-line locations of a 128-line table chunk no longer exceed the budget alone", () => {
    const lines = Array.from({ length: 128 }, (_, i) => `행 ${i} 보증금 ${i}`);
    const chunk = source(1, lines, Array(128).fill(3), 1);
    const selected = selectSources("onboarding", [chunk], "보증금 행");
    expect(selected.sources).toHaveLength(1);
    expect(promptSources(selected.sources)[0]!.locations).toEqual([
      { page: 3 },
    ]);
    expect(selected.evidenceBytes).toBeLessThanOrEqual(8000);
    // Stored provenance keeps every part.
    expect(selected.sources[0]!.locations).toHaveLength(128);
  });
  test("prompt locations list only the distinct locations inside the sent window", () => {
    const s = {
      ...source(2, ["가 3쪽", "나 3쪽", "다 4쪽"], [3, 3, 4], 1),
      evidenceWindow: { start: 10, end: 14 },
    };
    expect(evidenceContent(s)).toBe("다 4쪽");
    expect(promptLocations(s)).toEqual([{ page: 4 }]);
  });
  test("the top source is sent whole and later windows grow into the remaining budget", () => {
    const filler = (tag: string) =>
      Array.from({ length: 60 }, (_, i) => `${tag} 안내 문장 ${i}입니다.`);
    const top = source(3, filler("상위"), Array(60).fill(1), 1);
    const next = source(4, filler("보조"), Array(60).fill(2), 2);
    const selected = selectSources("onboarding", [top, next], "안내 문장");
    expect(selected.sources[0]!.evidenceWindow).toBeUndefined();
    const window = selected.sources[1]!.evidenceWindow!;
    // Initial windows are at most 1,800 bytes; growth uses the leftover budget.
    expect(
      Buffer.byteLength(next.content.slice(window.start, window.end)),
    ).toBeGreaterThan(1800);
    expect(selected.evidenceBytes).toBeLessThanOrEqual(8000);
    expect(
      Buffer.byteLength(JSON.stringify(promptSources(selected.sources))),
    ).toBe(selected.evidenceBytes);
  });
});

// R07: pdf.js emitted letter-spaced/per-glyph runs ("랜 선 회 의 실") and runs
// split inside a word ("현|재"); the parser inserted a space between every pair.
// Measured on the housing notice, touching runs ranged -0.28..+0.06 of height.
describe("R07 PDF runs that touch are one word", () => {
  const run = (
    index: number,
    str: string,
    x: number,
    width: number,
    over: Partial<PdfTextItem & { hasEOL: boolean }> = {},
  ) => ({
    index,
    str,
    x,
    y: 100,
    width,
    height: 10,
    upright: true,
    hasEOL: false,
    ...over,
  });
  test("letter-spaced and split runs join; a real gap, a new line or a rotation keeps a space", () => {
    const items = [
      run(0, "랜", 0, 10),
      run(1, "선", 7.8, 10), // overlaps by 0.22 of the height
      run(2, "회의실", 17.8, 30), // touching
      run(3, "본관", 50, 20), // gap 0.22 of the height: a word space
      run(4, "공고일 현", 75, 40),
      run(5, "재 소득", 115.6, 40, { hasEOL: true }), // +0.06
      run(6, "다음 줄", 0, 30, { y: 85 }),
    ];
    expect(streamText(items)).toBe(
      "랜선회의실 본관 공고일 현재 소득\n다음 줄 ",
    );
    // Another baseline, a rotation or a far jump back on the line is a space.
    expect(
      itemSeparator(run(0, "a", 0, 10), run(1, "b", 10, 10, { y: 104 })),
    ).toBe(" ");
    expect(
      itemSeparator(
        run(0, "a", 0, 10),
        run(1, "b", 10, 10, { upright: false }),
      ),
    ).toBe(" ");
    expect(itemSeparator(run(0, "a", 0, 300), run(1, "b", 10, 10))).toBe(" ");
    expect(
      itemSeparator(run(0, "a", 0, 10, { hasEOL: true }), run(1, "b", 10, 10)),
    ).toBe("\n");
  });
  test("touching runs inside a table cell join without a space", () => {
    const rules = {
      horizontal: [
        { at: 30, from: 0, to: 40 },
        { at: 20, from: 0, to: 40 },
        { at: 10, from: 20, to: 40 },
        { at: 0, from: 0, to: 40 },
      ],
      vertical: [
        { at: 0, from: 0, to: 30 },
        { at: 20, from: 0, to: 30 },
        { at: 40, from: 0, to: 30 },
      ],
    };
    const item = (
      index: number,
      x: number,
      y: number,
      str: string,
      width = 6,
    ) => ({ index, str, x, y, width, height: 4, upright: true }) as PdfTextItem;
    expect(
      pdfTables(rules, [
        item(0, 2, 23, "Rank"),
        item(1, 22, 23, "Rule"),
        item(2, 2, 8, "First"),
        item(3, 22, 13, "랜", 3),
        item(4, 24.6, 13, "선", 3), // overlaps by 0.1 of the height
        item(5, 30, 13, "실", 3), // gap 0.6 of the height: separate word
        item(6, 22, 3, "Family"),
      ]).map((t) => t.lines),
    ).toEqual([["Rank | Rule", "First | 랜선 실", "First | Family"]]);
  });
  test("words split from one crossing run keep their space even when the run is compressed", () => {
    const rules = {
      horizontal: [
        { at: 30, from: 0, to: 40 },
        { at: 20, from: 0, to: 40 },
        { at: 0, from: 0, to: 40 },
      ],
      vertical: [
        { at: 0, from: 0, to: 30 },
        { at: 20, from: 0, to: 30 },
        { at: 40, from: 0, to: 30 },
      ],
    };
    const item = (
      index: number,
      x: number,
      y: number,
      str: string,
      width = 6,
    ) => ({ index, str, x, y, width, height: 4, upright: true }) as PdfTextItem;
    // A narrow run: its estimated word gap (0.3 x 1.8 = 0.54) is below the
    // touching bound for height 4 (0.6), but the run text has a real space.
    const crossing = "ab cd" + " ".repeat(40) + "ef";
    const lines = pdfTables(rules, [
      item(0, 2, 23, "Rank"),
      item(1, 22, 23, "Rule"),
      item(2, 4, 8, crossing, 28.08),
    ]).map((t) => t.lines);
    expect(lines.flat().join("\n")).toContain("ab cd");
    expect(lines.flat().join("\n")).not.toContain("abcd");
  });
});
