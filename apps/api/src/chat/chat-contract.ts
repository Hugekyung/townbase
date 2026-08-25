import { BadRequestException } from "@nestjs/common";
import {
  buildRetrievalStrategy,
  classifyAutoRetrievalMode,
  type RetrievalStrategy,
} from "@townbase/rag-core";

export const CHAT_QUESTION_MODES = [
  "auto",
  "onboarding",
  "product_history",
  "documentation_gap",
] as const;

export type ChatQuestionMode = (typeof CHAT_QUESTION_MODES)[number];

export type ChatQuestionInput = Readonly<{
  workspaceId?: string;
  question: string;
  mode: ChatQuestionMode;
  topK: number;
}>;

export type ChatQuestionSelection = Readonly<{
  requestedMode: ChatQuestionMode;
  resolvedMode: Exclude<ChatQuestionMode, "auto">;
  strategy: RetrievalStrategy;
}>;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readTrimmedString = (value: Readonly<Record<string, unknown>>, key: string): string => {
  const rawValue = value[key];

  if (typeof rawValue !== "string") {
    throw new BadRequestException(`${key} must be a non-empty string`);
  }

  const trimmedValue = rawValue.trim();

  if (trimmedValue.length === 0) {
    throw new BadRequestException(`${key} must be a non-empty string`);
  }

  return trimmedValue;
};

const isChatQuestionMode = (value: string): value is ChatQuestionMode =>
  CHAT_QUESTION_MODES.includes(value as ChatQuestionMode);

const readQuestionMode = (value: Readonly<Record<string, unknown>>, key: string): ChatQuestionMode => {
  const rawValue = value[key];

  if (typeof rawValue !== "string") {
    throw new BadRequestException(`${key} must be one of the supported MCP question modes`);
  }

  const normalized = rawValue.trim();

  if (!isChatQuestionMode(normalized)) {
    throw new BadRequestException(`${key} must be one of the supported MCP question modes`);
  }

  return normalized;
};

export const DEFAULT_TOP_K = 5;
export const MAX_TOP_K = 50;

const readTopK = (value: Readonly<Record<string, unknown>>): number => {
  const rawValue = value.topK;

  if (rawValue === undefined) {
    return DEFAULT_TOP_K;
  }

  if (
    typeof rawValue !== "number" ||
    !Number.isInteger(rawValue) ||
    rawValue < 1 ||
    rawValue > MAX_TOP_K
  ) {
    throw new BadRequestException(`topK must be an integer between 1 and ${MAX_TOP_K}`);
  }

  return rawValue;
};

export const parseChatQuestionInput = (value: unknown): ChatQuestionInput => {
  if (!isRecord(value)) {
    throw new BadRequestException("question and mode are required");
  }

  if (value.question === undefined || value.mode === undefined) {
    throw new BadRequestException("question and mode are required");
  }

  return {
    ...(value.workspaceId === undefined ? {} : { workspaceId: readTrimmedString(value, "workspaceId") }),
    question: readTrimmedString(value, "question"),
    mode: readQuestionMode(value, "mode"),
    topK: readTopK(value),
  };
};

export const resolveChatQuestionSelection = (
  input: ChatQuestionInput,
): ChatQuestionSelection => {
  const resolvedMode =
    input.mode === "auto" ? classifyAutoRetrievalMode(input.question) : input.mode;
  const strategy = buildRetrievalStrategy(resolvedMode);

  if (strategy === null) {
    throw new BadRequestException(`Unsupported retrieval mode: ${resolvedMode}`);
  }

  return {
    requestedMode: input.mode,
    resolvedMode,
    strategy: {
      ...strategy,
      topK: input.topK,
    },
  };
};

export const classifyChatQuestionMode = (
  question: string | null | undefined,
): Exclude<ChatQuestionMode, "auto"> => classifyAutoRetrievalMode(question);
