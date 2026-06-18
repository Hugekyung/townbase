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
  workspaceId: string;
  question: string;
  mode: ChatQuestionMode;
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

export const parseChatQuestionInput = (value: unknown): ChatQuestionInput => {
  if (!isRecord(value)) {
    throw new BadRequestException("workspaceId, question, and mode are required");
  }

  if (value.workspaceId === undefined || value.question === undefined || value.mode === undefined) {
    throw new BadRequestException("workspaceId, question, and mode are required");
  }

  return {
    workspaceId: readTrimmedString(value, "workspaceId"),
    question: readTrimmedString(value, "question"),
    mode: readQuestionMode(value, "mode"),
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
    strategy,
  };
};

export const classifyChatQuestionMode = (
  question: string | null | undefined,
): Exclude<ChatQuestionMode, "auto"> => classifyAutoRetrievalMode(question);
