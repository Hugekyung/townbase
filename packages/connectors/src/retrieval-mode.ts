import {
  type PersistQuestionRetrievalSelectionInput,
  type PersistQuestionRetrievalSelectionSourceInput,
} from "@townbase/database";
import {
  buildRetrievalStrategy,
  rankRetrievalCandidates,
  resolveRetrievalMode,
  type RetrievalCandidate,
  type RetrievalMode,
  type RetrievalSelection,
  type ResolvedRetrievalMode,
} from "@townbase/rag-core";

export type ConnectorRetrievalSelectionInput = Readonly<{
  question: string;
  requestedMode: RetrievalMode;
  candidates: readonly RetrievalCandidate[];
}>;

export type ConnectorRetrievalSelectionResult = Readonly<{
  requestedMode: RetrievalMode;
  resolvedMode: ResolvedRetrievalMode;
  selectedSources: readonly ReturnType<typeof rankRetrievalCandidates>[number][];
  confidence: number;
  isAnswerable: boolean;
  strategy: ReturnType<typeof buildRetrievalStrategy> | null;
}>;

export type QuestionRetrievalTrace = Readonly<
  PersistQuestionRetrievalSelectionInput & {
    sources: readonly PersistQuestionRetrievalSelectionSourceInput[];
  }
>;

const clampConfidence = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  if (value >= 1) {
    return 1;
  }

  return value;
};

const countDistinctDocuments = (selectedSources: readonly { documentId: string }[]): number =>
  new Set(selectedSources.map((source) => source.documentId)).size;

const estimateConfidence = (selection: RetrievalSelection): number => {
  if (selection.selectedCandidates.length === 0 || selection.strategy === null) {
    return 0;
  }

  const topScore = selection.selectedCandidates[0]?.adjustedScore ?? 0;
  const sourceCountBoost = Math.min(selection.selectedCandidates.length, 5) * 0.05;
  const documentDiversityBoost = Math.min(countDistinctDocuments(selection.selectedCandidates), 3) * 0.03;
  return clampConfidence(topScore * 0.65 + sourceCountBoost + documentDiversityBoost);
};

export const selectQuestionRetrievalSources = (
  input: ConnectorRetrievalSelectionInput,
): ConnectorRetrievalSelectionResult => {
  const resolvedMode = resolveRetrievalMode(input.requestedMode, input.question);

  if (resolvedMode === "change_impact") {
    return {
      requestedMode: input.requestedMode,
      resolvedMode,
      selectedSources: [],
      confidence: 0,
      isAnswerable: false,
      strategy: null,
    };
  }

  const strategy = buildRetrievalStrategy(resolvedMode);

  const selectedSources = rankRetrievalCandidates(strategy, input.candidates);
  const selection: RetrievalSelection = {
    requestedMode: input.requestedMode,
    resolvedMode,
    strategy,
    selectedCandidates: selectedSources,
  };
  const confidence = estimateConfidence(selection);

  return {
    requestedMode: input.requestedMode,
    resolvedMode,
    selectedSources,
    confidence,
    isAnswerable: selectedSources.length > 0 && confidence >= 0.55,
    strategy,
  };
};

export const buildQuestionRetrievalTrace = (
  workspaceId: string,
  questionId: string,
  selection: ConnectorRetrievalSelectionResult,
): QuestionRetrievalTrace => ({
  workspaceId,
  questionId,
  requestedMode: selection.requestedMode,
  resolvedMode: selection.resolvedMode,
  confidence: selection.confidence,
  isAnswerable: selection.isAnswerable,
  sources: selection.selectedSources.map((source) => ({
    chunkId: source.id,
    mode: selection.resolvedMode,
    rank: source.rank,
    score: source.adjustedScore,
  })),
});
