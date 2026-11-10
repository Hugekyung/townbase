import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { randomUUID } from "node:crypto";

// Drive the actual component's event handlers and retained hook state. Effects
// run once on mount; DOM layout is excluded. This isolates routing AFTER a send failure.
// Normal browser upload/readback is verified separately with the synthetic API.
type ChangeEvent = {
  target: { value: string; files?: { name: string; size: number }[] };
};
type Props = Record<string, unknown> & {
  children?: unknown;
  onChange?: (event: ChangeEvent) => void;
  onSubmit?: (event: { preventDefault(): void }) => void;
  onClick?: () => void;
};
type Node = { type: unknown; props: Props };
function harness() {
  const slots: unknown[] = [];
  let cursor = 0;
  let mounted = false;
  const effects: (() => unknown)[] = [];
  const hooks = {
    useState<T>(initial: T | (() => T)) {
      const index = cursor++;
      if (!(index in slots))
        slots[index] =
          typeof initial === "function" ? (initial as () => T)() : initial;
      return [
        slots[index] as T,
        (next: T | ((prior: T) => T)) => {
          slots[index] =
            typeof next === "function"
              ? (next as (prior: T) => T)(slots[index] as T)
              : next;
        },
      ] as const;
    },
    useRef<T>(value: T) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: value };
      return slots[index] as { current: T };
    },
    useEffect: (effect: () => unknown) => {
      if (!mounted) effects.push(effect);
    },
    useLayoutEffect: () => {},
  };
  const unrelatedId = randomUUID(),
    fileId = randomUUID();
  let failedId = "";
  const api = jest.fn(
    async (url: string, method = "GET", body?: { requestId: string }) => {
      if (url === "/settings/agent")
        return { agent: { id: "synthetic-agent" } };
      if (url === "/settings/model-integration")
        return {
          supportedAnswerModels: ["gpt-6-luna", "gpt-6.1-sol"],
          credentials: {
            answer: { configured: true, enabled: true },
            embedding: { configured: true, enabled: true },
          },
          transfers: { rag: true, attachment: true },
          execution: {
            blocked: false,
            settings: {
              answerModel: "gpt-6-luna",
              reasoning: "low",
              monthlyBudgetUsd: "5.00",
              priceVersion: "test",
            },
            priceVersion: "test",
            supportedReasoning: {
              "gpt-6-luna": ["none", "low", "high"],
              "gpt-6.1-sol": ["low", "high"],
            },
          },
        };
      if (url.startsWith("/rag/conversations/"))
        return { turns: [], nextCursor: null };
      if (url === "/attachments" && method === "GET")
        return { attachments: [] };
      if (url === "/attachments" && method === "POST") return { id: fileId };
      if (url === "/attachment-tasks" && method === "POST") {
        failedId = body?.requestId ?? "";
        throw Error("lost response body");
      }
      if (url === "/attachment-tasks/" + failedId && method === "GET")
        return {
          requestId: failedId,
          status: "interrupted",
          sources: [],
          answer: null,
          question: "synthetic private task",
          result: null,
        };
      if (url === "/rag/questions/" + unrelatedId)
        return {
          requestId: unrelatedId,
          conversationId: unrelatedId,
          status: "answered",
          sources: [],
          answer: "unrelated",
          result: null,
        };
      throw Error("Unexpected API " + url);
    },
  );
  const remember = jest.fn(),
    saved = jest.fn();
  let workPromise: Promise<unknown> = Promise.resolve();
  const work = {
    busy: false,
    refresh: 0,
    run: (action: () => Promise<unknown>) => {
      workPromise = Promise.resolve()
        .then(action)
        .catch(() => undefined);
      return workPromise;
    },
  };
  const runtime = {
    jsx: (type: unknown, props: Props) => ({ type, props }),
    jsxs: (type: unknown, props: Props) => ({ type, props }),
    Fragment: "fragment",
  };
  const apiModule = {
    api,
    rememberRequest: remember,
    pendingRequest: () => ({ kind: "rag", id: unrelatedId }),
    encodedFile: async () => ({ name: "synthetic.txt", contentBase64: "eA==" }),
    errorText: () => "synthetic error",
    ApiError: class extends Error {
      constructor(..._args: unknown[]) {
        super("synthetic");
      }
    },
    download: async () => {},
  };
  const readinessExports: Record<string, unknown> = {};
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(
        path.resolve(__dirname, "../../web/src/workspace/model-readiness.ts"),
        "utf8",
      ),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText,
    { exports: readinessExports },
  );
  const exports: Record<string, (props: Record<string, unknown>) => Node> = {};
  const source = readFileSync(
    path.resolve(__dirname, "../../web/src/workspace/ChatPanel.tsx"),
    "utf8",
  );
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  vm.runInNewContext(js, {
    exports,
    require: (name: string) => {
      if (name === "react") return hooks;
      if (name === "react/jsx-runtime") return runtime;
      if (name === "../api") return apiModule;
      if (name === "./model-readiness") return readinessExports;
      if (name === "./Icon") return { Icon: () => null };
      throw Error("Unexpected component require " + name);
    },
    crypto: { randomUUID },
    AbortController,
    console,
    setTimeout,
    clearTimeout,
  });
  const ChatPanel = exports.ChatPanel;
  if (!ChatPanel) throw Error("Component export missing");
  const render = () => {
    cursor = 0;
    return ChatPanel({
      work,
      location: { kind: "rag", id: unrelatedId },
      name: "synthetic",
      onSaved: saved,
      onMessage: jest.fn(),
      onNavigate: jest.fn(),
      onNew: jest.fn(),
    }) as Node;
  };
  const find = (
    root: unknown,
    match: (node: Node) => boolean,
  ): Node | undefined => {
    if (Array.isArray(root)) {
      for (const node of root) {
        const found = find(node, match);
        if (found) return found;
      }
      return;
    }
    if (!root || typeof root !== "object") return;
    const node = root as Node;
    if (!node.props) return;
    if (match(node)) return node;
    return find(node.props.children, match);
  };
  return {
    render,
    mount: async () => {
      render();
      mounted = true;
      for (const effect of effects) effect();
      await new Promise<void>((resolve) => setImmediate(resolve));
    },
    find,
    api,
    remember,
    saved,
    wait: () => workPromise,
    failedId: () => failedId,
  };
}
test("private send failure from a RAG conversation rechecks the exact attachment request, not an unrelated RAG request", async () => {
  const h = harness();
  await h.mount();
  h.api.mockClear();
  let view = h.render();
  h.find(view, (n) => n.type === "input" && n.props.type === "file")!.props
    .onChange!({
    target: {
      files: [{ name: "synthetic.txt", size: 1 }],
      value: "synthetic.txt",
    },
  });
  view = h.render();
  h.find(
    view,
    (n) => n.type === "textarea" && n.props["aria-label"] === "메시지",
  )!.props.onChange!({
    target: { value: "summarize the synthetic attachment" },
  });
  view = h.render();
  h.find(view, (n) => n.type === "form")!.props.onSubmit!({
    preventDefault() {},
  });
  await h.wait();
  expect(h.failedId()).toMatch(/^[0-9a-f-]{36}$/);
  expect(h.remember).toHaveBeenCalledWith("attachment", h.failedId());
  view = h.render();
  const check = h.find(
    view,
    (n) => n.type === "button" && n.props.children === "요청 상태 확인",
  );
  expect(check).toBeDefined();
  check!.props.onClick!();
  await h.wait();
  expect(
    h.api.mock.calls
      .filter((call) => (call[1] ?? "GET") === "GET")
      .map((call) => call[0]),
  ).toEqual(["/attachment-tasks/" + h.failedId()]);
  expect(h.saved).toHaveBeenCalledWith("attachment", h.failedId());
});

test("chat controls send the selected model and reasoning with a private request", async () => {
  const h = harness();
  await h.mount();
  let view = h.render();
  h.find(
    view,
    (n) =>
      n.type === "select" && n.props["aria-label"] === "이 채팅의 답변 모델",
  )!.props.onChange!({ target: { value: "gpt-6.1-sol" } });
  view = h.render();
  h.find(
    view,
    (n) =>
      n.type === "select" && n.props["aria-label"] === "이 채팅의 추론 강도",
  )!.props.onChange!({ target: { value: "high" } });
  h.find(view, (n) => n.type === "input" && n.props.type === "file")!.props
    .onChange!({
    target: {
      files: [{ name: "synthetic.txt", size: 1 }],
      value: "synthetic.txt",
    },
  });
  view = h.render();
  h.find(view, (n) => n.type === "textarea")!.props.onChange!({
    target: { value: "Summarize" },
  });
  view = h.render();
  h.find(view, (n) => n.type === "form")!.props.onSubmit!({
    preventDefault() {},
  });
  await h.wait();
  const sent = h.api.mock.calls.find(
    (call) => call[0] === "/attachment-tasks" && call[1] === "POST",
  );
  expect(sent?.[2]).toMatchObject({
    modelOptions: { answerModel: "gpt-6.1-sol", reasoning: "high" },
  });
});
