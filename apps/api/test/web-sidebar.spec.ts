import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
type Node = { type: unknown; props: Record<string, unknown> };
function all(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(all);
  if (value == null || typeof value !== "object" || !("props" in value))
    return [];
  const node = value as Node;
  return [node, ...all(node.props.children)];
}
function words(value: unknown): string {
  if (Array.isArray(value)) return value.map(words).join("");
  if (value == null || typeof value === "boolean") return "";
  if (typeof value === "object") return words((value as Node).props?.children);
  return String(value);
}
function harness(wide: boolean) {
  const slots: unknown[] = [];
  let cursor = 0;
  const win = {
    location: { hash: "#/chat" },
    matchMedia: () => ({ matches: wide }),
  };
  const hooks = {
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots))
        slots[index] =
          typeof initial === "function"
            ? (initial as () => unknown)()
            : initial;
      return [
        slots[index],
        (next: unknown) => {
          slots[index] =
            typeof next === "function"
              ? (next as (p: unknown) => unknown)(slots[index])
              : next;
        },
      ];
    },
    useRef: (current: unknown) => ({ current }),
    useEffect: () => {},
  };
  const runtime = {
    jsx: (type: unknown, props: Record<string, unknown>) => ({ type, props }),
    jsxs: (type: unknown, props: Record<string, unknown>) => ({ type, props }),
  };
  const navExports: Record<string, unknown> = {};
  const compile = (file: string) =>
    ts.transpileModule(
      readFileSync(path.resolve(__dirname, "../../web/src/" + file), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText;
  vm.runInNewContext(compile("workspace/navigation.ts"), {
    exports: navExports,
    window: win,
  });
  const exports: Record<string, (props: unknown) => Node> = {};
  vm.runInNewContext(compile("Workspace.tsx"), {
    exports,
    window: win,
    localStorage: { getItem: () => "true" },
    require: (name: string) => {
      if (name === "react") return hooks;
      if (name === "react/jsx-runtime") return runtime;
      if (name === "./api") return { pendingRequest: () => null };
      if (name === "./workspace/navigation") return navExports;
      const key = name.split("/").at(-1)!;
      return { [key]: key };
    },
  });
  return {
    render: () => {
      cursor = 0;
      return exports.Workspace!({
        onExpired: () => {},
        username: "synthetic",
        account: null,
      });
    },
    click: (node: Node) => {
      (node.props.onClick as () => void)();
    },
  };
}
test("desktop sidebar stays pinned across new chats and settings navigation without a modal overlay", () => {
  const h = harness(true);
  let root = h.render();
  expect(root.props.className).toContain("menu-pinned");
  expect(all(root).find((n) => n.type === "aside")?.props.role).toBe(
    "complementary",
  );
  expect(all(root).some((n) => n.props.className === "drawer-backdrop")).toBe(
    false,
  );
  h.click(all(root).find((n) => n.props["aria-label"] === "새 채팅")!);
  root = h.render();
  expect(root.props.className).toContain("menu-pinned");
  h.click(
    all(root).find(
      (n) => n.type === "button" && words(n.props.children) === "설정",
    )!,
  );
  root = h.render();
  expect(root.props.className).toContain("menu-pinned");
  expect(
    all(root).some(
      (n) => n.type === "button" && words(n.props.children) === "API 사용량",
    ),
  ).toBe(true);
  h.click(all(root).find((n) => n.props["aria-label"] === "메뉴 접기")!);
  root = h.render();
  expect(all(root).some((n) => n.type === "aside")).toBe(false);
});
test("small screens retain an accessible modal drawer and close it after navigation", () => {
  const h = harness(false);
  let root = h.render();
  expect(root.props.className).not.toContain("menu-pinned");
  expect(all(root).find((n) => n.type === "aside")?.props["aria-modal"]).toBe(
    true,
  );
  expect(all(root).some((n) => n.props.className === "drawer-backdrop")).toBe(
    true,
  );
  h.click(all(root).find((n) => n.props["aria-label"] === "새 채팅")!);
  root = h.render();
  expect(all(root).some((n) => n.type === "aside")).toBe(false);
});
