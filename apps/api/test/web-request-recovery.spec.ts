import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
type Pending = { kind: string; id: string };
type WebApi = {
  api(
    url: string,
    method?: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<unknown>;
  rememberRequest(kind: string, id: string): void;
  pendingRequests(): Pending[];
  pendingRequest(kind?: string): Pending | null;
  confirmRequest(id: string): void;
  encodedFile(file: { size: number }, max: number): Promise<unknown>;
};
function browser() {
  const entries = new Map<string, string>();
  const fetch = jest.fn();
  const context = {
    exports: {},
    fetch,
    AbortController,
    setTimeout,
    clearTimeout,
    Event,
    window: { dispatchEvent: jest.fn() },
    sessionStorage: {
      getItem: (k: string) => entries.get(k) ?? null,
      setItem: (k: string, v: string) => entries.set(k, v),
      removeItem: (k: string) => entries.delete(k),
    },
  };
  const source = readFileSync(
    path.resolve(__dirname, "../../web/src/api.ts"),
    "utf8",
  );
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
    }).outputText,
    context,
  );
  return { api: context.exports as WebApi, fetch, entries };
}
test("file/model requests never overwrite an uncertain chat request", () => {
  const b = browser();
  b.api.rememberRequest("rag", id);
  b.api.rememberRequest("file", other);
  expect(b.api.pendingRequests()).toEqual([
    { kind: "rag", id },
    { kind: "file", id: other },
  ]);
  expect(b.api.pendingRequest("rag")?.id).toBe(id);
  b.api.confirmRequest(other);
  expect(b.api.pendingRequest()?.id).toBe(id);
});
test("successful response confirms only the saved request, while lost body preserves recovery", async () => {
  const b = browser();
  b.api.rememberRequest("rag", id);
  b.api.rememberRequest("model", other);
  const lost = new Error("connection lost");
  b.fetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    text: async () => {
      throw lost;
    },
  });
  await expect(b.api.api("/rag/questions/" + id)).rejects.toBe(lost);
  expect(b.api.pendingRequests()).toHaveLength(2);
  b.fetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ requestId: id, status: "answered" }),
  });
  await b.api.api("/rag/questions/" + id);
  expect(b.api.pendingRequests()).toEqual([{ kind: "model", id: other }]);
});
test.each(["not-json", "null", "[]"])(
  "malformed 2xx body never succeeds: %s",
  async (body) => {
    const b = browser();
    b.api.rememberRequest("rag", id);
    b.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => body,
    });
    await expect(b.api.api("/rag/questions/" + id)).rejects.toMatchObject({
      code: "invalid_response",
    });
    expect(b.api.pendingRequest()?.id).toBe(id);
  },
);
test("file validation cannot consume an existing recovery id", async () => {
  const b = browser();
  b.api.rememberRequest("rag", id);
  await expect(b.api.encodedFile({ size: 0 }, 20)).rejects.toMatchObject({
    code: "file_too_large",
  });
  expect(b.api.pendingRequest()?.id).toBe(id);
  expect(b.fetch).not.toHaveBeenCalled();
});
test("legacy single pending record is migrated without losing the original", () => {
  const b = browser();
  b.entries.set("townbase.pending", JSON.stringify({ kind: "attachment", id }));
  b.api.rememberRequest("file", other);
  expect(b.api.pendingRequests()).toHaveLength(2);
  expect(b.api.pendingRequest("attachment")?.id).toBe(id);
});
