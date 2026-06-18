import type { PromptTraceSource } from "./prompt-contract";

export type Citation = Readonly<{
  rank: number;
  title: string;
  sourceType: string;
  sourceReference: string;
  score: number;
}>;

export const buildCitations = (sources: readonly PromptTraceSource[]): readonly Citation[] =>
  sources.map((source) => ({
    rank: source.rank,
    title: source.title,
    sourceType: source.sourceType,
    sourceReference:
      source.filePath !== null
        ? source.filePath
        : source.sourceUrl !== null
          ? source.sourceUrl
          : source.documentId,
    score: source.score,
  }));
