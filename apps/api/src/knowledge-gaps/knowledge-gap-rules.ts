import type { PromptMode, PromptResolvedMode, PromptTraceSource } from "@townbase/agent-core";

type GapPriority = "low" | "medium" | "high";

const GAP_CONFIDENCE_THRESHOLD = 0.65;
const LOW_PRIORITY_THRESHOLD = 0.85;

export type KnowledgeGapCategory =
  | "architecture"
  | "auth"
  | "database"
  | "deployment"
  | "documentation"
  | "general"
  | "onboarding"
  | "operation"
  | "product_history"
  | "testing";

export type KnowledgeGapDerivationInput = Readonly<{
  questionId: string;
  question: string;
  requestedMode: PromptMode;
  resolvedMode: PromptResolvedMode;
  confidence: number;
  isAnswerable: boolean;
  knowledgeGap: string | null;
  sources: readonly PromptTraceSource[];
  similarQuestionCount?: number;
}>;

export type KnowledgeGapCandidate = Readonly<{
  questionId: string;
  category: KnowledgeGapCategory;
  title: string;
  description: string | null;
  suggestedDocumentTitle: string;
  suggestedMarkdownPath: string;
  suggestedGithubIssueTitle: string;
  priority: GapPriority;
  relatedMode: PromptResolvedMode;
  similarQuestionCount: number;
}>;

const CATEGORY_RULES: ReadonlyArray<Readonly<{ category: KnowledgeGapCategory; tokens: readonly string[] }>> = [
  { category: "database", tokens: ["database", "schema", "prisma", "sql", "postgres"] },
  { category: "deployment", tokens: ["deploy", "deployment", "release", "rollout", "docker", "compose"] },
  { category: "auth", tokens: ["auth", "login", "session", "jwt", "oauth"] },
  { category: "onboarding", tokens: ["onboarding", "setup", "getting started", "install", "local dev"] },
  { category: "architecture", tokens: ["architecture", "adr", "design decision", "system design"] },
  { category: "testing", tokens: ["test", "testing", "spec", "qa", "coverage"] },
  { category: "operation", tokens: ["ops", "operation", "incident", "runbook", "monitoring"] },
  { category: "product_history", tokens: ["prd", "history", "why", "decision", "change"] },
];

const normalizeQuestionSummary = (question: string): string => {
  const trimmed = question.trim().replace(/\s+/g, " ");
  return trimmed.endsWith("?") ? trimmed.slice(0, -1) : trimmed;
};

const toSlug = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

const detectCategory = (input: KnowledgeGapDerivationInput): KnowledgeGapCategory => {
  const haystack = [
    input.question,
    input.knowledgeGap ?? "",
    ...input.sources.flatMap((source) => [source.title, source.filePath ?? "", source.sourceUrl ?? "", source.sectionTitle ?? "", source.headingPath.join(" > ")]),
  ]
    .join(" ")
    .toLowerCase();

  for (const rule of CATEGORY_RULES) {
    if (rule.tokens.some((token) => haystack.includes(token))) {
      return rule.category;
    }
  }

  switch (input.resolvedMode) {
    case "onboarding":
      return "onboarding";
    case "product_history":
      return "product_history";
    case "documentation_gap":
      return "documentation";
    case "change_impact":
      return "general";
    default:
      return "general";
  }
};

const derivePriority = (confidence: number, sourceCount: number, isAnswerable: boolean): GapPriority => {
  if (sourceCount === 0 || confidence < 0.35) {
    return "high";
  }

  if (!isAnswerable || confidence < LOW_PRIORITY_THRESHOLD) {
    return "medium";
  }

  return "low";
};

export const shouldCreateKnowledgeGap = (input: KnowledgeGapDerivationInput): boolean =>
  !input.isAnswerable ||
  input.knowledgeGap !== null ||
  input.sources.length === 0 ||
  input.confidence < GAP_CONFIDENCE_THRESHOLD;

export const deriveKnowledgeGapCandidate = (
  input: KnowledgeGapDerivationInput,
): KnowledgeGapCandidate | null => {
  if (!shouldCreateKnowledgeGap(input)) {
    return null;
  }

  const questionSummary = normalizeQuestionSummary(input.question);
  const category = detectCategory(input);
  const similarQuestionCount = input.similarQuestionCount ?? 0;

  return {
    questionId: input.questionId,
    category,
    title: `Documentation gap: ${questionSummary}`,
    description:
      input.knowledgeGap ?? `The current sources do not fully answer: ${questionSummary}.`,
    suggestedDocumentTitle: `Document ${questionSummary}`,
    suggestedMarkdownPath: `docs/gaps/${toSlug(`${category}-${questionSummary}`)}.md`,
    suggestedGithubIssueTitle: `Document ${questionSummary}`,
    priority: derivePriority(input.confidence, input.sources.length, input.isAnswerable),
    relatedMode: input.resolvedMode,
    similarQuestionCount,
  };
};
