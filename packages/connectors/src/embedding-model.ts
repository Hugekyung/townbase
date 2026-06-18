import {
  createOpenAIEmbeddingModel,
  DEFAULT_OPENAI_EMBEDDING_MODEL_NAME,
  type EmbeddingModel,
} from "@townbase/rag-core";

const DEFAULT_OPENAI_EMBEDDING_BASE_URL = "https://api.openai.com/v1";

export type EmbeddingModelEnv = Readonly<{
  openaiApiKey: string;
  openaiEmbeddingModel?: string;
  openaiEmbeddingBaseUrl?: string;
  fetchImpl?: typeof fetch;
}>;

const normalizeOptional = (value: string | undefined): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length === 0 ? undefined : trimmed;
};

export const loadEmbeddingModelEnv = (): EmbeddingModelEnv => {
  const openaiApiKey = process.env.OPENAI_API_KEY?.trim();

  if (openaiApiKey === undefined || openaiApiKey.length === 0) {
    throw new Error("Missing required environment variable: OPENAI_API_KEY");
  }

  const openaiEmbeddingModel = normalizeOptional(process.env.OPENAI_EMBEDDING_MODEL);
  const openaiEmbeddingBaseUrl =
    normalizeOptional(process.env.OPENAI_EMBEDDING_BASE_URL) ??
    DEFAULT_OPENAI_EMBEDDING_BASE_URL;

  return {
    openaiApiKey,
    ...(openaiEmbeddingModel === undefined
      ? {}
      : { openaiEmbeddingModel }),
    openaiEmbeddingBaseUrl,
  };
};

export const createEmbeddingModel = (
  env: EmbeddingModelEnv,
): EmbeddingModel =>
  createOpenAIEmbeddingModel({
    apiKey: env.openaiApiKey,
    model: env.openaiEmbeddingModel ?? DEFAULT_OPENAI_EMBEDDING_MODEL_NAME,
    baseUrl: env.openaiEmbeddingBaseUrl ?? DEFAULT_OPENAI_EMBEDDING_BASE_URL,
    ...(env.fetchImpl === undefined ? {} : { fetchImpl: env.fetchImpl }),
  });
