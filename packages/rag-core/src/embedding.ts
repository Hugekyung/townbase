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
  dimensions: number;
  embedText: (text: string) => Promise<EmbeddingVector>;
  embedTexts: (texts: readonly string[]) => Promise<readonly EmbeddingVector[]>;
}>;

const DEFAULT_OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_EMBEDDING_DIMENSIONS = 1536;
const MODELS_WITHOUT_DIMENSIONS_SUPPORT = new Set(["text-embedding-ada-002"]);

const assertNonEmpty = (value: string, label: string): string => {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new Error(`${label} must not be empty`);
  }

  return trimmed;
};

const normalizeDimensions = (dimensions: number | undefined): number | undefined => {
  if (dimensions === undefined) {
    return undefined;
  }

  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error("dimensions must be a positive integer");
  }

  return dimensions;
};

const parseEmbeddingResponse = async (
  response: Response,
  expectedDimensions: number,
): Promise<readonly EmbeddingVector[]> => {
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

    if (vector.length !== expectedDimensions) {
      throw new Error(
        `OpenAI embedding response item ${index} has ${vector.length} dimensions; expected ${expectedDimensions}`,
      );
    }

    return vector;
  });
};

const postEmbeddings = async (
  config: Required<Pick<EmbeddingModelConfig, "apiKey">> &
    Readonly<{
      model: string;
      baseUrl: string;
      fetchImpl: typeof fetch;
      dimensions?: number;
    }>,
  input: readonly string[],
): Promise<readonly EmbeddingVector[]> => {
  const body = {
    model: config.model,
    input,
    ...(config.dimensions === undefined ? {} : { dimensions: config.dimensions }),
  };

  const response = await config.fetchImpl(`${config.baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`OpenAI embedding request failed with status ${response.status}`);
  }

  return parseEmbeddingResponse(response, config.dimensions ?? DEFAULT_EMBEDDING_DIMENSIONS);
};

export const createOpenAIEmbeddingModel = (
  config: EmbeddingModelConfig,
): EmbeddingModel => {
  const apiKey = assertNonEmpty(config.apiKey, "apiKey");
  const model = config.model?.trim() || DEFAULT_OPENAI_EMBEDDING_MODEL;
  const baseUrl = config.baseUrl?.trim() || DEFAULT_OPENAI_BASE_URL;
  const fetchImpl = config.fetchImpl ?? fetch;
  const dimensions = normalizeDimensions(config.dimensions) ?? DEFAULT_EMBEDDING_DIMENSIONS;
  const supportsDimensions = !MODELS_WITHOUT_DIMENSIONS_SUPPORT.has(model);

  if (typeof fetchImpl !== "function") {
    throw new Error("fetch implementation is required");
  }

  return {
    model,
    dimensions,
    async embedText(text: string): Promise<EmbeddingVector> {
      const [embedding] = await postEmbeddings(
        {
          apiKey,
          model,
          baseUrl,
          fetchImpl,
          ...(supportsDimensions ? { dimensions } : {}),
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
          ...(supportsDimensions ? { dimensions } : {}),
        },
        normalizedTexts,
      );
    },
  };
};

export const DEFAULT_OPENAI_EMBEDDING_MODEL_NAME = DEFAULT_OPENAI_EMBEDDING_MODEL;
