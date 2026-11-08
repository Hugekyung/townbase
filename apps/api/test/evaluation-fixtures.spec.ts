import { createRequire } from "node:module";
import {
  unicodePdf,
  unicodeDocx,
  corpusFixtures,
} from "../scripts/evaluation-fixtures";
import path from "node:path";
const { FileExtractor } = createRequire(__filename)(
  "../dist/files/file-extractor",
) as typeof import("../src/files/file-extractor");
test.each(["pdf", "docx"] as const)(
  "Korean evaluation %s preserves factual text without font downloads",
  async (format) => {
    const text =
      "# 합성 문서\n상태: 승인 / 시행일:2026-10-01\n### F1\n기본 배송비:3,000원.\n### F2\n반품 기간:수령 후7일.";
    const e = await new FileExtractor().extract(
      "synthetic." + format,
      format === "pdf" ? unicodePdf(text) : unicodeDocx(text),
    );
    expect(
      e.segments
        .map((s) => s.text)
        .join("\n")
        .replace(/\s+/g, ""),
    ).toContain("기본배송비:3,000원.");
    expect(
      e.segments
        .map((s) => s.text)
        .join("\n")
        .replace(/\s+/g, ""),
    ).toContain("반품기간:수령후7일.");
  },
);
test.each(["ops", "shop"] as const)(
  "locks independent %s corpus and complete question denominators",
  async (kind) => {
    const result = await corpusFixtures(
      path.resolve(__dirname, "../../../docs/evaluation/v0.2"),
      kind,
    );
    expect(result.documents).toHaveLength(12);
    expect(result.questions).toHaveLength(60);
    expect(result.documents.map((d) => d.format)).toEqual([
      "pdf",
      "pdf",
      "pdf",
      "docx",
      "docx",
      "docx",
      "md",
      "md",
      "md",
      "txt",
      "txt",
      "txt",
    ]);
  },
);
