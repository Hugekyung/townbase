import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
type Element = { type: unknown; props: Record<string, unknown> };
function nodes(v: unknown): Element[] {
  if (Array.isArray(v)) return v.flatMap(nodes);
  if (v == null || typeof v !== "object" || !("props" in v)) return [];
  const n = v as Element;
  return [n, ...nodes(n.props.children)];
}
function text(v: unknown): string {
  if (Array.isArray(v)) return v.map(text).join("");
  if (v == null || typeof v === "boolean") return "";
  if (typeof v === "object") return text((v as Element).props?.children);
  return String(v);
}
const compile = (file: string, tail = "") =>
  ts.transpileModule(
    readFileSync(
      path.resolve(__dirname, "../../web/src/workspace/" + file),
      "utf8",
    ) + tail,
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
const policy: Record<string, unknown> = {};
vm.runInNewContext(compile("model-readiness.ts"), { exports: policy });
const steps = policy.modelSetupSteps as (
  i: unknown,
  opts: unknown,
) => { id: string; ready: boolean }[];
const fixture = () => ({
  credentials: {
    answer: {
      configured: true,
      enabled: true,
      connection: "not_checked",
      masked: "********",
    },
    embedding: {
      configured: true,
      enabled: true,
      connection: "not_checked",
      masked: "********",
    },
  },
  supportedAnswerModels: ["gpt-6-luna"],
  execution: {
    settings: {
      answerModel: "gpt-6-luna",
      reasoning: "low",
      monthlyBudgetUsd: null as string | null,
      priceVersion: null as string | null,
    },
    priceVersion: "approved",
    blocked: true,
  },
  transfers: { rag: false, attachment: false, documentEmbedding: false },
});
function componentHarness(api: jest.Mock) {
  const slots: unknown[] = [];
  let cursor = 0,
    mounted = false;
  const effects: (() => unknown)[] = [];
  const hooks = {
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [
        slots[index],
        (next: unknown) => {
          slots[index] =
            typeof next === "function"
              ? (next as (v: unknown) => unknown)(slots[index])
              : next;
        },
      ];
    },
    useEffect(effect: () => unknown) {
      if (!mounted) effects.push(effect);
    },
  };
  const exports: Record<string, (props: unknown) => Element> = {};
  const jsx = (type: unknown, props: Record<string, unknown>) => ({
    type,
    props,
  });
  vm.runInNewContext(compile("SettingsPanel.tsx", "\nexport {KeyForm};"), {
    exports,
    require: (name: string) => {
      if (name === "react") return hooks;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "./model-readiness") return policy;
      if (name === "../api")
        return {
          api,
          errorText: () => "synthetic read error",
          rememberRequest: () => {},
        };
      throw Error(name);
    },
    AbortController,
    console,
  });
  let pending: Promise<unknown> = Promise.resolve();
  const changed = jest.fn();
  const work = {
    busy: false,
    refresh: 0,
    run: (action: () => Promise<unknown>) => {
      pending = action().catch(() => undefined);
      return pending;
    },
  };
  let data = fixture().credentials.answer;
  const props = {
    purpose: "answer",
    get data() {
      return data;
    },
    work,
    onChanged: (value: ReturnType<typeof fixture>) => {
      data = value.credentials.answer;
      changed(value);
    },
  };
  const render = (name = "SettingsPanel") => {
    cursor = 0;
    return exports[name]!(name === "KeyForm" ? props : { work });
  };
  return {
    render,
    changed,
    wait: () => pending,
    mount: async () => {
      render();
      mounted = true;
      effects.forEach((effect) => effect());
      await new Promise<void>((resolve) => setImmediate(resolve));
    },
  };
}
test("saved Keys are complete while missing budget, price, transfer and Agent remain explicit", () => {
  const s = steps(fixture(), { agentConfigured: false });
  expect(s.filter((x) => x.ready).map((x) => x.id)).toEqual([
    "answer-key",
    "embedding-key",
  ]);
  expect(s.filter((x) => !x.ready).map((x) => x.id)).toEqual([
    "budget",
    "price",
    "rag-transfer",
    "agent",
  ]);
});
test("a ready RAG configuration permits chat; exhausted budget remains blocked", () => {
  const value = fixture();
  value.execution.settings.monthlyBudgetUsd = "1.00";
  value.execution.settings.priceVersion = "approved";
  value.execution.blocked = false;
  value.transfers.rag = true;
  expect(steps(value, { agentConfigured: true }).every((x) => x.ready)).toBe(
    true,
  );
  value.execution.blocked = true;
  expect(
    steps(value, { agentConfigured: true })
      .filter((x) => !x.ready)
      .map((x) => x.id),
  ).toEqual(["available-budget"]);
});
test("pure attachments do not require an embedding Key or RAG transfer", () => {
  const value = fixture();
  value.execution.settings.monthlyBudgetUsd = "1.00";
  value.execution.settings.priceVersion = "approved";
  value.execution.blocked = false;
  value.transfers.attachment = true;
  value.credentials.embedding.enabled = false;
  expect(
    steps(value, { privateMode: true, agentConfigured: true }).every(
      (x) => x.ready,
    ),
  ).toBe(true);
  expect(
    steps(value, {
      privateMode: true,
      mixed: true,
      agentConfigured: true,
    }).some((x) => !x.ready),
  ).toBe(true);
});
test("a slow file listing does not block the saved model settings", async () => {
  const api = jest.fn((url: string) =>
    url === "/settings/model-integration"
      ? Promise.resolve(fixture())
      : url === "/settings/agent"
        ? Promise.resolve({ agent: null })
        : new Promise(() => {}),
  );
  const h = componentHarness(api);
  await h.mount();
  const root = h.render();
  expect(text(root)).toContain("문서 채팅 준비 상태");
  expect(text(root)).toContain("1. OpenAI 연결·전송 허용");
  expect(text(root)).toContain("기본 Agent·참조 문서를 확인하고 있어요");
});
test("failed settings load leaves a retry action instead of indefinite loading", async () => {
  const api = jest.fn((url: string) =>
    url === "/settings/model-integration"
      ? Promise.reject(Error("read failure"))
      : url === "/settings/agent"
        ? Promise.resolve({ agent: null })
        : Promise.resolve({ items: [], nextCursor: null }),
  );
  const h = componentHarness(api);
  await h.mount();
  const root = h.render();
  expect(text(root)).toContain("설정을 불러오지 못했어요");
  expect(
    nodes(root).find(
      (n) =>
        n.type === "button" && text(n.props.children) === "설정 상태 다시 확인",
    )?.props.disabled,
  ).toBe(false);
});
for (const readFails of [false, true])
  test(`Key save reads back safe status; read failure=${readFails} is distinguished from save failure`, async () => {
    const api = jest.fn((_url: string, method = "GET") =>
      method === "PUT"
        ? Promise.resolve({ configured: true, enabled: true })
        : readFails
          ? Promise.reject(Error("read failure"))
          : Promise.resolve(fixture()),
    );
    const h = componentHarness(api);
    let root = h.render("KeyForm");
    const inputs = nodes(root).filter((n) => n.type === "input");
    (inputs[0]!.props.onChange as (e: unknown) => void)({
      target: { value: "synthetic-only-api-key" },
    });
    (inputs[1]!.props.onChange as (e: unknown) => void)({
      target: { value: "synthetic-password" },
    });
    root = h.render("KeyForm");
    (root.props.onSubmit as (e: unknown) => void)({ preventDefault() {} });
    await h.wait();
    root = h.render("KeyForm");
    expect(api.mock.calls.map((c) => c[1] ?? "GET")).toEqual(["PUT", "GET"]);
    expect(text(root)).toContain("Key를 저장했어요");
    expect(text(root)).toContain("미검사 (저장은 완료)");
    expect(h.changed).toHaveBeenCalledTimes(readFails ? 0 : 1);
    if (readFails)
      expect(text(root)).toContain("최신 상태를 확인하지 못했어요");
    for (const field of nodes(root).filter((n) => n.type === "input"))
      expect(field.props.value).toBe("");
  });
