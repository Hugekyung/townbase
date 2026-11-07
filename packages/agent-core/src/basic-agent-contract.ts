// Self-hosted contracts. Legacy PromptMode, including its reserved mode, stays intact.
export const BASIC_AGENT_MODES = [
  "auto",
  "onboarding",
  "product_history",
  "documentation_gap",
] as const;
export type BasicAgentMode = (typeof BASIC_AGENT_MODES)[number];
export type BasicAgentConfiguration = Readonly<{
  name: string;
  purpose: string;
  instructions: string;
  terminology: readonly Readonly<{ term: string; meaning: string }>[];
}> &
  (
    | Readonly<{ sourceSelection: "all"; sourceOriginalIds: readonly [] }>
    | Readonly<{
        sourceSelection: "selected";
        sourceOriginalIds: readonly string[];
      }>
  );
export type BasicAgentQuestion = Readonly<{
  requestId: string;
  question: string;
  requestedMode: BasicAgentMode;
}>;
export class AgentContractError extends Error {
  constructor(readonly code: "invalid_request" | "question_too_long") {
    super(code);
  }
}
function exact(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    value != null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",")
  );
}
export function parseBasicAgentQuestion(value: unknown): BasicAgentQuestion {
  if (
    value != null &&
    typeof value === "object" &&
    "question" in value &&
    typeof value.question === "string" &&
    value.question.length > 8000
  )
    throw new AgentContractError("question_too_long");
  if (
    !exact(value, ["requestId", "question", "requestedMode"]) ||
    typeof value.requestId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.requestId,
    ) ||
    typeof value.question !== "string" ||
    !value.question.trim() ||
    Buffer.from(value.question, "utf8").toString("utf8") !== value.question ||
    value.question.includes("\u0000") ||
    !BASIC_AGENT_MODES.includes(value.requestedMode as BasicAgentMode)
  )
    throw new AgentContractError("invalid_request");
  if (value.question.length > 8000 || Array.from(value.question).length > 4000)
    throw new AgentContractError("question_too_long");
  // Preserve user text; never silently truncate or rewrite it.
  return {
    requestId: value.requestId.toLowerCase(),
    question: value.question,
    requestedMode: value.requestedMode as BasicAgentMode,
  };
}

// Terminal RAG result contract, not an implemented HTTP endpoint or model schema.
// E02/E03 must validate provider output and persist before returning this result.
export type BasicAgentSource = Readonly<{
  chunkId: string;
  indexId: string;
  originalId: string;
  versionId: string;
  scopeRevision: number;
  title: string;
  reference: string;
  locations: readonly Readonly<{
    segment: number;
    start: number;
    end: number;
    location: Readonly<{
      page?: number;
      paragraph?: number;
      lineStart?: number;
      lineEnd?: number;
    }>;
    headingPath: readonly string[];
  }>[];
}>;
type BasicAgentResultIdentity = Readonly<{
  requestId: string;
  agentId: string;
  agentRevision: number;
  requestedMode: BasicAgentMode;
  resolvedMode: Exclude<BasicAgentMode, "auto">;
}>;
export type BasicAgentResult = BasicAgentResultIdentity &
  (
    | Readonly<{
        status: "answered";
        model: string;
        isAnswerable: true;
        answer: string;
        sources: readonly BasicAgentSource[];
        gapId: null;
      }>
    | Readonly<{
        status: "refused";
        model: string | null;
        isAnswerable: false;
        answer: string;
        sources: readonly BasicAgentSource[];
        gapId: string | null;
      }>
  );
// Technical failures are separate errors, never a fabricated refused result/Gap.
