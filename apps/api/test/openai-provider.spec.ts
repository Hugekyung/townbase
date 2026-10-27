import {
  OpenAIProvider,
  parseProvider,
  parseUsage,
  type ProviderRequest,
} from "../src/model-integration/openai-provider";
const request: ProviderRequest = {
  model: "gpt-6-luna",
  input: "Synthetic",
  outputLimit: 128,
  reasoning: "low",
};
export function responseFixture() {
  return {
    id: "resp_synthetic",
    model: "gpt-6-luna",
    status: "completed",
    error: null,
    output: [
      { type: "reasoning" },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "OK" }],
      },
    ],
    usage: {
      input_tokens: 100,
      output_tokens: 10,
      total_tokens: 110,
      input_tokens_details: {
        cached_tokens: 20,
        cache_write_tokens: 30,
        cache_write_tokens_details: { ttl_30m_tokens: 30, ttl_12h_tokens: 0 },
      },
      output_tokens_details: { reasoning_tokens: 5 },
    },
  };
}
describe("fixed OpenAI provider protocol", () => {
  afterEach(() => jest.restoreAllMocks());
  test("parses an answer and incomplete reasoning-only response with nonzero usage", () => {
    expect(parseProvider(responseFixture(), request).text).toBe("OK");
    expect(
      parseProvider(
        { ...responseFixture(), status: "incomplete", output: [] },
        request,
      ),
    ).toMatchObject({ outcome: "incomplete", usage: { output: 10 } });
  });
  test.each([
    undefined,
    null,
    { input_tokens: 1 },
    { ...responseFixture().usage, total_tokens: 111 },
    {
      ...responseFixture().usage,
      input_tokens_details: {
        cached_tokens: 200,
        cache_write_tokens: 0,
        cache_write_tokens_details: { ttl_30m_tokens: 0, ttl_12h_tokens: 0 },
      },
    },
    { ...responseFixture().usage, output_tokens: -1 },
    {
      ...responseFixture().usage,
      input_tokens_details: {
        ...responseFixture().usage.input_tokens_details,
        cache_write_tokens: 1,
      },
    },
  ])("rejects malformed or absent usage %#", (usage) =>
    expect(() => parseUsage(usage, false)).toThrow(),
  );
  test.each([
    { ...responseFixture(), model: "other" },
    { ...responseFixture(), status: "failed" },
    { ...responseFixture(), output: [] },
    { ...responseFixture(), output: [{ type: "function_call" }] },
    {
      ...responseFixture(),
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "refusal", refusal: "No" }],
        },
      ],
    },
  ])("rejects mismatched or unsupported answers %#", (value) =>
    expect(() => parseProvider(value, request)).toThrow(),
  );
  test("requires exactly one finite 1536-dimension embedding with the expected model/index", () => {
    const req = { ...request, model: "text-embedding-3-small" },
      v = {
        model: "text-embedding-3-small",
        data: [{ index: 0, embedding: Array(1536).fill(0.1) }],
        usage: { prompt_tokens: 2, total_tokens: 2 },
      };
    expect(parseProvider(v, req).embedding).toHaveLength(1536);
    for (const data of [
      [],
      [{ index: 1, embedding: Array(1536).fill(0.1) }],
      [{ index: 0, embedding: [0.1] }],
      [{ index: 0, embedding: Array(1536).fill(NaN) }],
    ])
      expect(() => parseProvider({ ...v, data }, req)).toThrow();
  });
  test("sends fixed foreground Responses request with no retries/tools/stored response", async () => {
    const spy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(responseFixture())));
    const result = await new OpenAIProvider().call(
      "synthetic-key",
      request,
      AbortSignal.timeout(5000),
    );
    expect(result.text).toBe("OK");
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init?.redirect).toBe("error");
    expect(JSON.parse(init!.body as string)).toEqual({
      model: "gpt-6-luna",
      input: "Synthetic",
      max_output_tokens: 128,
      reasoning: { effort: "low" },
      store: false,
      background: false,
      stream: false,
      service_tier: "default",
      prompt_cache_options: { ttl: "30m" },
      tools: [],
    });
  });
  test("uses fixed embedding route/dimensions without an external vector store", async () => {
    const spy = jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "text-embedding-3-small",
          data: [{ index: 0, embedding: Array(1536).fill(0.1) }],
          usage: { prompt_tokens: 1, total_tokens: 1 },
        }),
      ),
    );
    await new OpenAIProvider().call(
      "synthetic-key",
      { ...request, model: "text-embedding-3-small" },
      AbortSignal.timeout(5000),
    );
    expect(spy.mock.calls[0]![0]).toBe("https://api.openai.com/v1/embeddings");
    expect(JSON.parse(spy.mock.calls[0]![1]!.body as string)).toMatchObject({
      dimensions: 1536,
      encoding_format: "float",
    });
  });
  test.each([401, 403, 429, 500])(
    "sanitizes HTTP %i and never retries",
    async (status) => {
      const spy = jest
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response("secret-provider-body", { status }));
      await expect(
        new OpenAIProvider().call(
          "synthetic-key",
          request,
          AbortSignal.timeout(5000),
        ),
      ).rejects.not.toThrow("secret-provider-body");
      expect(spy).toHaveBeenCalledTimes(1);
    },
  );
  test("bounds response bodies and rejects malformed JSON", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("x".repeat(1048577)))
      .mockResolvedValueOnce(new Response("not json"));
    await expect(
      new OpenAIProvider().call(
        "synthetic",
        request,
        AbortSignal.timeout(5000),
      ),
    ).rejects.toThrow("provider_response_too_large");
    await expect(
      new OpenAIProvider().call(
        "synthetic",
        request,
        AbortSignal.timeout(5000),
      ),
    ).rejects.toThrow("invalid_provider_response");
  });
});
