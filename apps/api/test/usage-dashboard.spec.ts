import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
type Element = { type: unknown; props: Record<string, unknown> };
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join("");
  if (value == null || typeof value === "boolean") return "";
  if (typeof value === "object")
    return text((value as Element).props?.children);
  return String(value);
}
test("refresh preserves usage while pending or failed, then replaces it on success", async () => {
  const slots: unknown[] = [];
  let cursor = 0;
  const effects: (() => void)[] = [];
  const cleanups = new Map<number, () => void>();
  const usage = (calls: string) => ({
    start: "2026-11-01",
    end: "2026-12-01",
    timeZone: "UTC",
    daily: [],
    groups: [
      {
        model: "fixture",
        purpose: "rag_answer",
        status: "succeeded",
        calls,
        measuredCalls: "0",
        inputTokens: "0",
        cachedTokens: "0",
        outputTokens: "0",
        reasoningTokens: "0",
        chargedUsd: "0",
        heldUsd: "0",
      },
    ],
  });
  const budget = {
    settings: { monthlyBudgetUsd: "1.00" },
    heldUsd: "0",
    chargedUsd: "0",
    blocked: false,
    warning80: false,
  };
  const api = jest.fn(
    (url: string): Promise<unknown> =>
      Promise.resolve(url.endsWith("usage") ? usage("7") : budget),
  );
  const hooks = {
    useState: (initial: unknown) => {
      const i = cursor++;
      if (!(i in slots)) slots[i] = initial;
      return [
        slots[i],
        (v: unknown) => {
          slots[i] = v;
        },
      ];
    },
    useEffect: (effect: () => unknown, deps: unknown[]) => {
      const i = cursor++,
        old = slots[i] as unknown[] | undefined;
      if (!old || deps.some((v, j) => v !== old[j])) {
        slots[i] = deps;
        effects.push(() => {
          cleanups.get(i)?.();
          const cleanup = effect();
          if (typeof cleanup === "function")
            cleanups.set(i, cleanup as () => void);
        });
      }
    },
  };
  const exports: Record<string, (props: unknown) => Element> = {};
  const jsx = (type: unknown, props: Record<string, unknown>) => ({
    type,
    props,
  });
  const code = ts.transpileModule(
    readFileSync(
      path.resolve(__dirname, "../../web/src/workspace/UsageDashboard.tsx"),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  vm.runInNewContext(code, {
    exports,
    AbortController,
    require: (name: string) =>
      name === "react"
        ? hooks
        : name === "react/jsx-runtime"
          ? { jsx, jsxs: jsx }
          : { api, errorText: () => "갱신 실패" },
  });
  const work = { busy: false, refresh: 0, run: async () => {} };
  const render = () => {
    cursor = 0;
    const root = exports.UsageDashboard!({ work });
    effects.splice(0).forEach((e) => e());
    return text(root);
  };
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
  render();
  await tick();
  expect(render()).toContain("7회");
  let resolveUsage!: (value: unknown) => void;
  api.mockImplementation((url) =>
    url.endsWith("usage")
      ? new Promise((resolve) => {
          resolveUsage = resolve;
        })
      : Promise.resolve(budget),
  );
  work.refresh++;
  render();
  expect(render()).toContain("7회");
  expect(render()).toContain("갱신하고 있어요");
  resolveUsage(usage("9"));
  await tick();
  expect(render()).toContain("9회");
  expect(render()).not.toContain("갱신하고 있어요");
  api.mockRejectedValue(Error("synthetic error"));
  work.refresh++;
  render();
  await tick();
  expect(render()).toContain("9회");
  expect(render()).toContain("갱신 실패");
  cleanups.forEach((cleanup) => cleanup());
});
