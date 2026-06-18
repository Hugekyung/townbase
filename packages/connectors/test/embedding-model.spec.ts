import { createEmbeddingModel, loadEmbeddingModelEnv } from "../src/embedding-model";

describe("embedding model config", () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  it("loads OpenAI embedding settings with defaults", () => {
    process.env = {
      ...originalEnv,
      OPENAI_API_KEY: "secret",
    };

    expect(loadEmbeddingModelEnv()).toEqual({
      openaiApiKey: "secret",
      openaiEmbeddingModel: undefined,
      openaiEmbeddingBaseUrl: "https://api.openai.com/v1",
    });
  });

  it("creates an embedding model with the configured OpenAI endpoint", async () => {
    const fetchImpl = jest.fn(async () =>
      new Response(JSON.stringify({ data: [{ embedding: [1, 2, 3] }] }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );

    const model = createEmbeddingModel({
      openaiApiKey: "secret",
      openaiEmbeddingModel: "text-embedding-3-small",
      openaiEmbeddingBaseUrl: "https://api.openai.com/v1",
      fetchImpl,
    });

    await expect(model.embedText("hello")).resolves.toEqual([1, 2, 3]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
