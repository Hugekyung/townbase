import type { PromptTraceSource } from "./prompt-contract";

export type Citation = Readonly<{
  documentId: string;
  chunkId: string;
  rank: number;
  title: string;
  sourceType: string;
  sourceReference: string;
  sectionTitle: string | null;
  headingPath: readonly string[];
  score: number;
}>;

export const buildCitations = (sources: readonly PromptTraceSource[]): readonly Citation[] =>
  sources.map((source) => ({
    documentId: source.documentId,
    chunkId: source.chunkId,
    rank: source.rank,
    title: source.title,
    sourceType: source.sourceType,
    sourceReference: source.filePath ?? source.sourceUrl ?? source.documentId,
    sectionTitle: source.sectionTitle,
    headingPath: source.headingPath,
    score: source.score,
  }));
