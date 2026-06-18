export type PromptTemplateKey =
  | "system"
  | "onboarding"
  | "product_history"
  | "documentation_gap"
  | "fallback";

export type PromptMode = "auto" | "onboarding" | "product_history" | "documentation_gap" | "change_impact";

export type PromptResolvedMode = Exclude<PromptMode, "auto">;

export type PromptResponseSchema = Readonly<{
  answer: string;
  isAnswerable: boolean;
  confidence: number;
  knowledgeGap: string | null;
  suggestedFollowups: readonly string[];
}>;

export type PromptTraceSource = Readonly<{
  documentId: string;
  chunkId: string;
  sourceType: string;
  title: string;
  filePath: string | null;
  sourceUrl: string | null;
  sectionTitle: string | null;
  headingPath: readonly string[];
  rank: number;
  score: number;
}>;

export type PromptContextInput = Readonly<{
  question: string;
  requestedMode: PromptResolvedMode;
  resolvedMode: PromptResolvedMode;
  sources: readonly PromptTraceSource[];
}>;

export type PromptContext = Readonly<{
  question: string;
  requestedMode: PromptResolvedMode;
  resolvedMode: PromptResolvedMode;
  sourceCount: number;
  sourceSummary: string;
  sourceCitations: readonly string[];
}>;

export const PROMPT_RESPONSE_SCHEMA_KEYS = [
  "answer",
  "isAnswerable",
  "confidence",
  "knowledgeGap",
  "suggestedFollowups",
] as const;

export const SOURCE_GROUNDED_ANSWER_RULE = [
  "Only from the provided sources.",
  "If the sources do not support the answer, say so explicitly.",
  "Do not invent facts, file paths, or decisions.",
  "Always cite the source rows used for the answer.",
].join(" ");

export const buildEmptyPromptContext = (
  input: Pick<PromptContextInput, "question" | "requestedMode" | "resolvedMode">,
): PromptContext => ({
  question: input.question,
  requestedMode: input.requestedMode,
  resolvedMode: input.resolvedMode,
  sourceCount: 0,
  sourceSummary: "No traced sources were selected.",
  sourceCitations: [],
});
