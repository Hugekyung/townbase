import {
  createOpenAIEmbeddingModel,
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_OPENAI_EMBEDDING_MODEL_NAME,
} from "../src/embedding";

describe("createOpenAIEmbeddingModel", () => {
  it("posts texts to the OpenAI embeddings endpoint and returns vectors", async () => {
    const firstVector = Array.from({ length: 1536 }, (_, index) => (index === 0 ? 0.1 : 0));
    const secondVector = Array.from({ length: 1536 }, (_, index) => (index === 0 ? 0.4 : 0));
    const fetchImpl = jest.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            { embedding: firstVector },
            { embedding: secondVector },
          ],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );

    const model = createOpenAIEmbeddingModel({
      apiKey: "test-key",
      fetchImpl,
      model: "text-embedding-3-small",
      baseUrl: "https://api.openai.com/v1",
    });

    await expect(model.embedText("hello world")).resolves.toEqual(firstVector);
    await expect(model.embedTexts(["hello", "world"])).resolves.toEqual([firstVector, secondVector]);
    expect(model.model).toBe(DEFAULT_OPENAI_EMBEDDING_MODEL_NAME);
    expect(model.dimensions).toBe(DEFAULT_EMBEDDING_DIMENSIONS);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://api.openai.com/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: ["hello world"],
          dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://api.openai.com/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: ["hello", "world"],
          dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
        }),
      }),
    );
  });

  it("includes configured dimensions in the OpenAI request body", async () => {
    const vector = Array.from({ length: 1536 }, () => 0.1);
    const fetchImpl = jest.fn(async () =>
      new Response(JSON.stringify({ data: [{ embedding: vector }] }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );

    const model = createOpenAIEmbeddingModel({
      apiKey: "test-key",
      fetchImpl,
      model: "text-embedding-3-small",
      baseUrl: "https://api.openai.com/v1",
      dimensions: 1536,
    });

    await expect(model.embedText("hello world")).resolves.toEqual(vector);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.openai.com/v1/embeddings",
      expect.objectContaining({
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: ["hello world"],
          dimensions: 1536,
        }),
      }),
    );
  });

  it("rejects invalid embedding dimensions before making a request", () => {
    expect(() =>
      createOpenAIEmbeddingModel({
        apiKey: "test-key",
        fetchImpl: jest.fn(),
        dimensions: 0,
      }),
    ).toThrow("dimensions must be a positive integer");
  });

  it("rejects empty api keys and empty texts before making a request", async () => {
    const fetchImpl = jest.fn();

    expect(() =>
      createOpenAIEmbeddingModel({
        apiKey: "   ",
        fetchImpl,
      }),
    ).toThrow("apiKey must not be empty");

    const model = createOpenAIEmbeddingModel({
      apiKey: "test-key",
      fetchImpl: async () =>
        new Response(JSON.stringify({ data: [{ embedding: [1, 2, 3] }] }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }),
    });

    await expect(model.embedText("   ")).rejects.toThrow("text must not be empty");
  });
});
