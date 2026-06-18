export type EmbeddingVector = readonly number[];

export type EmbeddingModelConfig = Readonly<{
  apiKey: string;
  model?: string;
  dimensions?: number;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}>;

export type EmbeddingModel = Readonly<{
  model: string;
  embedText: (text: string) => Promise<EmbeddingVector>;
  embedTexts: (texts: readonly string[]) => Promise<readonly EmbeddingVector[]>;
}>;

const DEFAULT_OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

const assertNonEmpty = (value: string, label: string): string => {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new Error(`${label} must not be empty`);
  }

  return trimmed;
};

const parseEmbeddingResponse = async (response: Response): Promise<readonly EmbeddingVector[]> => {
  const payload: unknown = await response.json();

  if (
    typeof payload !== "object" ||
    payload === null ||
    !("data" in payload) ||
    !Array.isArray((payload as { data?: unknown }).data)
  ) {
    throw new Error("OpenAI embedding response payload is invalid");
  }

  return (payload as { data: Array<{ embedding?: unknown }> }).data.map((item, index) => {
    if (!item || !Array.isArray(item.embedding)) {
      throw new Error(`OpenAI embedding response item ${index} is invalid`);
    }

    const embedding = item.embedding;
    const vector = embedding.map((value) => {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`OpenAI embedding response item ${index} contains a non-numeric value`);
      }

      return value;
    });

    return vector;
  });
};

const postEmbeddings = async (
  config: Required<Pick<EmbeddingModelConfig, "apiKey">> &
    Readonly<{
      model: string;
      baseUrl: string;
      fetchImpl: typeof fetch;
    }>,
  input: readonly string[],
): Promise<readonly EmbeddingVector[]> => {
  const response = await config.fetchImpl(`${config.baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      input,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI embedding request failed with status ${response.status}`);
  }

  return parseEmbeddingResponse(response);
};

export const createOpenAIEmbeddingModel = (
  config: EmbeddingModelConfig,
): EmbeddingModel => {
  const apiKey = assertNonEmpty(config.apiKey, "apiKey");
  const model = config.model?.trim() || DEFAULT_OPENAI_EMBEDDING_MODEL;
  const baseUrl = config.baseUrl?.trim() || DEFAULT_OPENAI_BASE_URL;
  const fetchImpl = config.fetchImpl ?? fetch;

  if (typeof fetchImpl !== "function") {
    throw new Error("fetch implementation is required");
  }

  return {
    model,
    async embedText(text: string): Promise<EmbeddingVector> {
      const [embedding] = await postEmbeddings(
        {
          apiKey,
          model,
          baseUrl,
          fetchImpl,
        },
        [assertNonEmpty(text, "text")],
      );

      if (embedding === undefined) {
        throw new Error("OpenAI embedding response did not include an embedding");
      }

      return embedding;
    },
    async embedTexts(texts: readonly string[]): Promise<readonly EmbeddingVector[]> {
      if (texts.length === 0) {
        return [];
      }

      const normalizedTexts = texts.map((text) => assertNonEmpty(text, "text"));
      return postEmbeddings(
        {
          apiKey,
          model,
          baseUrl,
          fetchImpl,
        },
        normalizedTexts,
      );
    },
  };
};

export const DEFAULT_OPENAI_EMBEDDING_MODEL_NAME = DEFAULT_OPENAI_EMBEDDING_MODEL;
