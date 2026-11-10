// Bounded, deterministic lexical retrieval; never a semantic similarity score.
const ignored = new Set([
  "알려줘",
  "알려주세요",
  "설명해줘",
  "설명",
  "주세요",
  "무엇",
  "어떻게",
  "언제",
  "왜",
  "현재",
  "지금",
  "경우",
  "대한",
  "관련",
  "있어",
  "없어",
  "있는데",
  "있으면",
  "되는",
  "해야",
  "가능",
  "얼마",
  "각각",
  "기준",
  "문서",
  "공고",
  "내용",
  "신청",
  "사람",
  "the",
  "what",
  "is",
  "how",
]);
export function normalizeRetrievalText(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/gu, "");
}
export function retrievalTerms(question: string): string[] {
  const words =
    question
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  return [
    ...new Set(
      words
        .map((word) =>
          word.replace(
            /(?:으로는|에서는|으로|에서|에게|까지|이면|하면|인데|이고|이야|이나|거나|보다|처럼|들은|들이|은|는|을|를|의|과|와|이|가|에|도)$/u,
            "",
          ),
        )
        .filter(
          (word) => word.length >= 2 && word.length <= 64 && !ignored.has(word),
        ),
    ),
  ].slice(0, 24);
}
export function lexicalMatches(question: string, content: string): number {
  const normalized = normalizeRetrievalText(content);
  return retrievalTerms(question).filter((term) => normalized.includes(term))
    .length;
}
// Offsets address the exact original string, not normalized or reconstructed text.
// A table without reliable boundaries remains whole rather than cutting a cell.
export function evidenceUnits(
  text: string,
): Array<{ start: number; end: number }> {
  const boundaries = [0];
  const separator = /\n+|(?<=[.!?。])\s+|\s+(?=[•※■◎①②③④⑤⑥⑦⑧⑨])/gu;
  for (const match of text.matchAll(separator)) {
    const end = match.index! + match[0].length;
    if (end > boundaries[boundaries.length - 1]!) boundaries.push(end);
  }
  if (boundaries.at(-1) !== text.length) boundaries.push(text.length);
  return boundaries
    .slice(0, -1)
    .map((start, i) => ({ start, end: boundaries[i + 1]! }))
    .filter((range) => text.slice(range.start, range.end).trim());
}
