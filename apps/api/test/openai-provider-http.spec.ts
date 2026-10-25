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
    server.on("request", (req, res) => {
      hits.push(req.url!);
      res.writeHead(302, { Location: url + "/forbidden" });
      res.end();
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
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow();
    expect(hits).toEqual(["/responses"]);
  });
  test("aborts a real stalled response and does not retry", async () => {
    let hits = 0;
    server.on("request", () => {
      hits++;
    });
    jest
      .spyOn(globalThis, "fetch")
      .mockImplementation((_target, init) => nativeFetch(url, init));
    await expect(
      new OpenAIProvider().call(
        "synthetic",
        {
          model: "gpt-6-luna",
          input: "synthetic",
          reasoning: "low",
          outputLimit: 128,
        },
        AbortSignal.timeout(50),
      ),
    ).rejects.toThrow();
    expect(hits).toBe(1);
  });
});
