export const RETRIEVAL_MODES = [
  "auto",
  "onboarding",
  "product_history",
  "documentation_gap",
  "change_impact",
] as const;

export type RetrievalMode = (typeof RETRIEVAL_MODES)[number];

export type ResolvedRetrievalMode = Exclude<RetrievalMode, "auto">;

export type RetrievalCandidate = Readonly<{
  id: string;
  documentId: string;
  sourceType: string;
  knowledgeTypes: readonly string[];
  status: string;
  sourcePriority: number;
  score: number;
}>;

export type RankedRetrievalCandidate = RetrievalCandidate &
  Readonly<{
    rank: number;
    adjustedScore: number;
  }>;

export type RetrievalStrategy = Readonly<{
  mode: ResolvedRetrievalMode;
  topK: number;
  sourceTypes: readonly string[];
  knowledgeTypes: readonly string[];
  excludedStatuses: readonly string[];
  sourcePriorityWeight: number;
}>;

export type RetrievalStrategyContext = Readonly<{
  question: string;
  requestedMode: RetrievalMode;
  resolvedMode: ResolvedRetrievalMode;
}>;

export type RetrievalSelection = Readonly<{
  requestedMode: RetrievalMode;
  resolvedMode: ResolvedRetrievalMode;
  strategy: RetrievalStrategy | null;
  selectedCandidates: readonly RankedRetrievalCandidate[];
}>;

const ONBOARDING_KEYWORDS = [
  "how do i",
  "how to",
  "onboarding",
  "setup",
  "install",
  "run locally",
  "start locally",
  "deploy",
  "where should i start",
  "new contributor",
  "local development",
];

const PRODUCT_HISTORY_KEYWORDS = [
  "why did",
  "what changed",
  "when did",
  "decision",
  "history",
  "background",
  "incident",
  "release",
  "deprecat",
  "tradeoff",
];

const DOCUMENTATION_GAP_KEYWORDS = [
  "what is missing",
  "missing docs",
  "undocumented",
  "not documented",
  "documentation gap",
  "gap",
  "where is",
  "which document",
  "what isn't documented",
  "what is not documented",
];

const MODE_PROFILES: Readonly<Record<ResolvedRetrievalMode, RetrievalStrategy>> = {
  onboarding: {
    mode: "onboarding",
    topK: 8,
    sourceTypes: ["notion_page", "repo_readme", "repo_docs", "adr", "schema"],
    knowledgeTypes: ["onboarding", "domain_policy", "architecture", "deployment", "operation", "code_convention"],
    excludedStatuses: ["deprecated", "archived"],
    sourcePriorityWeight: 0.05,
  },
  product_history: {
    mode: "product_history",
    topK: 10,
    sourceTypes: ["prd", "adr", "notion_page", "incident_review", "repo_docs"],
    knowledgeTypes: ["product_history", "architecture", "domain_policy", "incident"],
    excludedStatuses: ["archived"],
    sourcePriorityWeight: 0.05,
  },
  documentation_gap: {
    mode: "documentation_gap",
    topK: 6,
    sourceTypes: ["notion_page", "github_issue", "github_pr", "repo_docs"],
    knowledgeTypes: ["documentation_gap"],
    excludedStatuses: ["archived", "deprecated"],
    sourcePriorityWeight: 0.03,
  },
  change_impact: {
    mode: "change_impact",
    topK: 6,
    sourceTypes: ["prd", "adr", "notion_page"],
    knowledgeTypes: ["change_impact", "architecture", "domain_policy"],
    excludedStatuses: ["archived"],
    sourcePriorityWeight: 0.03,
  },
};

const normalizeQuestion = (question: string): string => question.trim().toLowerCase();

const containsAny = (question: string, keywords: readonly string[]): boolean =>
  keywords.some((keyword) => question.includes(keyword));

export const classifyAutoRetrievalMode = (question: string): Exclude<ResolvedRetrievalMode, "change_impact"> => {
  const normalizedQuestion = normalizeQuestion(question);

  if (containsAny(normalizedQuestion, DOCUMENTATION_GAP_KEYWORDS)) {
    return "documentation_gap";
  }

  if (containsAny(normalizedQuestion, ONBOARDING_KEYWORDS)) {
    return "onboarding";
  }

  if (containsAny(normalizedQuestion, PRODUCT_HISTORY_KEYWORDS)) {
    return "product_history";
  }

  return "onboarding";
};

export const resolveRetrievalMode = (
  requestedMode: RetrievalMode,
  question: string,
): ResolvedRetrievalMode => {
  if (requestedMode !== "auto") {
    return requestedMode;
  }

  return classifyAutoRetrievalMode(question);
};

export function buildRetrievalStrategy(mode: "change_impact"): null;
export function buildRetrievalStrategy(
  mode: Exclude<ResolvedRetrievalMode, "change_impact">,
): RetrievalStrategy;
export function buildRetrievalStrategy(mode: ResolvedRetrievalMode): RetrievalStrategy | null {
  if (mode === "change_impact") {
    return null;
  }

  return MODE_PROFILES[mode];
}

const normalizeScore = (score: number): number => {
  if (!Number.isFinite(score)) {
    return 0;
  }

  if (score < 0) {
    return 0;
  }

  if (score > 1) {
    return 1;
  }

  return score;
};

const countKnowledgeMatches = (
  candidateKnowledgeTypes: readonly string[],
  strategyKnowledgeTypes: readonly string[],
): number => {
  const strategyKnowledgeTypeSet = new Set(strategyKnowledgeTypes);
  return candidateKnowledgeTypes.reduce(
    (count, knowledgeType) => count + (strategyKnowledgeTypeSet.has(knowledgeType) ? 1 : 0),
    0,
  );
};

const hasAllowedSourceType = (candidateSourceType: string, sourceTypes: readonly string[]): boolean =>
  sourceTypes.length === 0 || sourceTypes.includes(candidateSourceType);

const hasAllowedKnowledgeType = (
  candidateKnowledgeTypes: readonly string[],
  strategyKnowledgeTypes: readonly string[],
): boolean => strategyKnowledgeTypes.length === 0 || countKnowledgeMatches(candidateKnowledgeTypes, strategyKnowledgeTypes) > 0;

const isExcludedStatus = (status: string, excludedStatuses: readonly string[]): boolean =>
  excludedStatuses.includes(status);

export const scoreRetrievalCandidate = (
  strategy: RetrievalStrategy,
  candidate: RetrievalCandidate,
): number => {
  const baseScore = normalizeScore(candidate.score);
  const sourcePriorityBoost = Math.min(Math.max(candidate.sourcePriority, 0), 10) * strategy.sourcePriorityWeight;
  const knowledgeMatchBoost = countKnowledgeMatches(candidate.knowledgeTypes, strategy.knowledgeTypes) * 0.05;
  const sourceTypeBoost = strategy.sourceTypes.includes(candidate.sourceType) ? 0.08 : 0;
  const statusBoost =
    candidate.status === "active"
      ? 0.06
      : candidate.status === "draft"
        ? 0.03
        : candidate.status === "deprecated"
          ? -0.08
          : -0.12;

  return baseScore + sourcePriorityBoost + knowledgeMatchBoost + sourceTypeBoost + statusBoost;
};

export const rankRetrievalCandidates = (
  strategy: RetrievalStrategy,
  candidates: readonly RetrievalCandidate[],
): readonly RankedRetrievalCandidate[] => {
  const filteredCandidates = candidates.filter(
    (candidate) =>
      hasAllowedSourceType(candidate.sourceType, strategy.sourceTypes) &&
      hasAllowedKnowledgeType(candidate.knowledgeTypes, strategy.knowledgeTypes) &&
      !isExcludedStatus(candidate.status, strategy.excludedStatuses),
  );

  return filteredCandidates
    .map((candidate) => ({
      ...candidate,
      adjustedScore: scoreRetrievalCandidate(strategy, candidate),
    }))
    .sort((left, right) => {
      if (right.adjustedScore !== left.adjustedScore) {
        return right.adjustedScore - left.adjustedScore;
      }

      if (right.sourcePriority !== left.sourcePriority) {
        return right.sourcePriority - left.sourcePriority;
      }

      return left.id.localeCompare(right.id);
    })
    .map((candidate, index) => ({
      ...candidate,
      rank: index + 1,
    }))
    .slice(0, strategy.topK);
};

export const selectRetrievalCandidates = (
  context: RetrievalStrategyContext,
  candidates: readonly RetrievalCandidate[],
): RetrievalSelection => {
  if (context.resolvedMode === "change_impact") {
    return {
      requestedMode: context.requestedMode,
      resolvedMode: context.resolvedMode,
      strategy: null,
      selectedCandidates: [],
    };
  }

  const strategy = buildRetrievalStrategy(context.resolvedMode);

  return {
    requestedMode: context.requestedMode,
    resolvedMode: context.resolvedMode,
    strategy,
    selectedCandidates: rankRetrievalCandidates(strategy, candidates),
  };
};
