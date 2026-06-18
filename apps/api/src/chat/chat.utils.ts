type ParsedChatResponse = Readonly<{
  answer: string;
  isAnswerable: boolean;
  confidence: number;
  knowledgeGap: string | null;
  suggestedFollowups: readonly string[];
  tokenUsage: Readonly<{
    input: number;
    output: number;
  }>;
}>;

const clampConfidence = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }

  if (value < 0) {
    return 0;
  }

  if (value > 1) {
    return 1;
  }

  return value;
};

const extractJsonObject = (rawResponse: string): string => {
  const jsonStart = rawResponse.indexOf("{");
  const jsonEnd = rawResponse.lastIndexOf("}");

  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
    throw new Error("LLM response does not contain a valid JSON object");
  }

  return rawResponse.slice(jsonStart, jsonEnd + 1);
};

export const parseChatQuestionResponse = (
  rawResponse: string,
  sourceCount: number,
): ParsedChatResponse => {
  const payload: unknown = JSON.parse(extractJsonObject(rawResponse));

  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof (payload as { answer?: unknown }).answer !== "string" ||
    typeof (payload as { isAnswerable?: unknown }).isAnswerable !== "boolean" ||
    typeof (payload as { confidence?: unknown }).confidence !== "number" ||
    !Array.isArray((payload as { suggestedFollowups?: unknown }).suggestedFollowups)
  ) {
    throw new Error("LLM response payload is invalid");
  }

  const suggestedFollowups = (payload as { suggestedFollowups: unknown[] }).suggestedFollowups.map(
    (item, index) => {
      if (typeof item !== "string") {
        throw new Error(`LLM suggestedFollowups[${index}] must be a string`);
      }

      return item;
    },
  );
  const tokenUsage =
    typeof (payload as { tokenUsage?: unknown }).tokenUsage === "object" &&
    (payload as { tokenUsage?: { input?: unknown; output?: unknown } }).tokenUsage !== null
      ? (payload as { tokenUsage: { input?: unknown; output?: unknown } }).tokenUsage
      : undefined;

  return {
    answer: (payload as { answer: string }).answer,
    isAnswerable: (payload as { isAnswerable: boolean }).isAnswerable && sourceCount > 0,
    confidence: clampConfidence((payload as { confidence: number }).confidence),
    knowledgeGap:
      typeof (payload as { knowledgeGap?: unknown }).knowledgeGap === "string"
        ? (payload as { knowledgeGap: string }).knowledgeGap
        : null,
    suggestedFollowups,
    tokenUsage: {
      input:
        typeof tokenUsage?.input === "number" && Number.isFinite(tokenUsage.input)
          ? tokenUsage.input
          : 0,
      output:
        typeof tokenUsage?.output === "number" && Number.isFinite(tokenUsage.output)
          ? tokenUsage.output
          : 0,
    },
  };
};

export const scoreQuestionConfidence = (input: Readonly<{
  parsedConfidence: number;
  sourceCount: number;
  topScore: number;
  isAnswerable: boolean;
}>): number => {
  const sourceBoost = Math.min(input.sourceCount * 0.05, 0.2);
  const scoreBoost = Math.max(0, Math.min(input.topScore, 1)) * 0.1;
  const answerabilityPenalty = input.isAnswerable ? 0 : 0.4;

  return clampConfidence(input.parsedConfidence + sourceBoost + scoreBoost - answerabilityPenalty);
};
