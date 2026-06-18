import { createOpenAIEmbeddingModel, DEFAULT_OPENAI_EMBEDDING_MODEL_NAME } from "../src/embedding";

describe("createOpenAIEmbeddingModel", () => {
  it("posts texts to the OpenAI embeddings endpoint and returns vectors", async () => {
    const fetchImpl = jest.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            { embedding: [0.1, 0.2, 0.3] },
            { embedding: [0.4, 0.5, 0.6] },
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

    await expect(model.embedText("hello world")).resolves.toEqual([0.1, 0.2, 0.3]);
    await expect(model.embedTexts(["hello", "world"])).resolves.toEqual([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ]);
    expect(model.model).toBe(DEFAULT_OPENAI_EMBEDDING_MODEL_NAME);
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
        }),
      }),
    );
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
