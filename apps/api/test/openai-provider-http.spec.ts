import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { OpenAIProvider } from "../src/model-integration/openai-provider";
const nativeFetch = globalThis.fetch;
describe("OpenAI transport observed on loopback only", () => {
  let server: Server, url: string;
  beforeEach(async () => {
    server = createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  test("preserves actual headers/body, enforces redirect rejection without following it", async () => {
    const hits: string[] = [];
    const observed: Array<{
      authorization: string | undefined;
      contentType: string | undefined;
      body: unknown;
    }> = [];
    server.on("request", (req, res) => {
      hits.push(req.url!);
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      req.on("end", () => {
        observed.push({
          authorization: req.headers.authorization,
          contentType: req.headers["content-type"],
          body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
        });
        res.writeHead(302, { Location: url + "/forbidden" });
        res.end();
      });
    });
    jest.spyOn(globalThis, "fetch").mockImplementation((target, init) => {
      expect(target).toBe("https://api.openai.com/v1/responses");
      expect((init!.headers as Record<string, string>).Authorization).toBe(
        "Bearer synthetic",
      );
      return nativeFetch(url + "/responses", init);
    });
    await expect(
      new OpenAIProvider().call(
        "synthetic",
        {
          model: "gpt-6-luna",
          input: "synthetic",
          reasoning: "low",
          outputLimit: 128,
        },
        AbortSignal.timeout(5000),
      ),
    ).rejects.toThrow();
    expect(hits).toEqual(["/responses"]);
    expect(observed).toEqual([
      {
        authorization: "Bearer synthetic",
        contentType: "application/json",
        body: {
          model: "gpt-6-luna",
          input: "synthetic",
          max_output_tokens: 128,
          reasoning: { effort: "low" },
          store: false,
          background: false,
          stream: false,
          service_tier: "default",
          prompt_cache_options: { ttl: "30m" },
          tools: [],
        },
      },
    ]);
  }, 10000);
  test("aborts a real stalled response and does not retry", async () => {
    let hits = 0;
    const controller = new AbortController();
    server.on("request", () => {
      hits++;
      // Abort only after delivery; leave the handler without a response.
      controller.abort();
    });
    jest
      .spyOn(globalThis, "fetch")
      .mockImplementation((_target, init) => nativeFetch(url, init));
    const watchdog = setTimeout(() => controller.abort(), 5000);
    try {
      await expect(
        new OpenAIProvider().call(
          "synthetic",
          {
            model: "gpt-6-luna",
            input: "synthetic",
            reasoning: "low",
            outputLimit: 128,
          },
          controller.signal,
        ),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(hits).toBe(1);
    } finally {
      clearTimeout(watchdog);
    }
  }, 10000);
});
