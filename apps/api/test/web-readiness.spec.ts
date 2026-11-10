import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

type Element = { type: unknown; props: Record<string, unknown> };
async function screen(body: Record<string, unknown>, status: number) {
  const slots: unknown[] = [];
  let cursor = 0;
  let mounted = false;
  const effects: (() => unknown)[] = [];
  const hooks = {
    StrictMode: "StrictMode",
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [
        slots[index],
        (next: unknown) => {
          slots[index] = next;
        },
      ];
    },
    useEffect(effect: () => unknown) {
      if (!mounted) effects.push(effect);
    },
  };
  const jsx = (type: unknown, props: Record<string, unknown>) => ({
    type,
    props,
  });
  const source = readFileSync(
    path.resolve(__dirname, "../../web/src/main.tsx"),
    "utf8",
  );
  const compiled = ts.transpileModule(source + "\nmodule.exports = { App };", {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const module = { exports: {} as { App?: () => Element } };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    require: (name: string) => {
      if (name === "react") return hooks;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "react-dom/client")
        return { createRoot: () => ({ render: () => {} }) };
      if (name === "./AuthPanel") return { AuthPanel: "AuthPanel" };
      if (name === "./SetupForm") return { SetupForm: "SetupForm" };
      if (name === "./style.css") return {};
      throw Error(name);
    },
    document: { getElementById: () => ({}) },
    fetch: async () => ({ status, json: async () => body }),
    AbortController,
    setTimeout,
    clearTimeout,
  });
  const render = () => {
    cursor = 0;
    return module.exports.App!();
  };
  render();
  mounted = true;
  for (const effect of effects) effect();
  await new Promise<void>((resolve) => setImmediate(resolve));
  return render();
}
function nodes(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (value == null || typeof value !== "object" || !("props" in value))
    return [];
  const node = value as Element;
  return [node, ...nodes(node.props.children)];
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join("");
  if (value == null || typeof value === "boolean") return "";
  if (typeof value === "object")
    return text((value as Element).props?.children);
  return String(value);
}
const infrastructure = {
  database: "ready",
  schema: "ready",
  storage: "ready",
  setup: "complete",
};
test("lost execution ownership is visible despite all infrastructure being connected and blocks login", async () => {
  const root = await screen(
    { ...infrastructure, execution: "unavailable" },
    503,
  );
  const checks = nodes(root).filter((n) => n.props.className === "check");
  expect(checks).toHaveLength(5);
  expect(text(checks[4])).toContain("문서 처리·채팅 서비스");
  expect(text(checks[4])).toContain("연결 필요");
  expect(text(root)).toContain("문서 처리·채팅 서비스가 준비되지 않았어요");
  expect(nodes(root).find((n) => n.type === "AuthPanel")?.props.blocked).toBe(
    true,
  );
});
test("ready service permits authentication and displays consistent connected state", async () => {
  const root = await screen({ ...infrastructure, execution: "ready" }, 200);
  expect(nodes(root).find((n) => n.type === "AuthPanel")?.props.blocked).toBe(
    false,
  );
  expect(text(root)).toContain("관리자 등록도 완료됐어요");
  expect(text(root)).not.toContain("연결 필요");
});
test("unavailable setup is visible and does not offer authentication", async () => {
  const root = await screen(
    { ...infrastructure, setup: "unavailable", execution: "unavailable" },
    503,
  );
  expect(text(root)).toContain("관리자 초기화 상태를 확인하지 못했어요");
  expect(
    text(nodes(root).filter((n) => n.props.className === "check")[3]),
  ).toContain("연결 필요");
  expect(nodes(root).some((n) => n.type === "AuthPanel")).toBe(false);
});
test("missing execution field fails closed instead of treating infrastructure alone as ready", async () => {
  const root = await screen(infrastructure, 200);
  expect(text(root)).toContain("서버 상태를 가져오지 못했어요");
  expect(nodes(root).some((n) => n.type === "AuthPanel")).toBe(false);
});
test("HTTP failure never enables login even if individual reported checks are ready", async () => {
  const root = await screen({ ...infrastructure, execution: "ready" }, 503);
  expect(nodes(root).find((n) => n.type === "AuthPanel")?.props.blocked).toBe(
    true,
  );
  expect(
    text(nodes(root).filter((n) => n.props.className === "check")[4]),
  ).toContain("연결 필요");
});
