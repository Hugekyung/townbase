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
  const listeners = new Map<string, (e: unknown) => void>();
  const media = {
    matches: wide,
    addEventListener: (_: string, fn: (e: unknown) => void) =>
      listeners.set("media", fn),
    removeEventListener: () => listeners.delete("media"),
  };
  const win = {
    location: { hash: "#/chat" },
    matchMedia: () => media,
    addEventListener: (key: string, fn: (e: unknown) => void) =>
      listeners.set("window:" + key, fn),
    removeEventListener: (key: string) => listeners.delete("window:" + key),
  };
  const preferences = new Map([["townbase.menu-open", "true"]]);
  const doc = {
    activeElement: null as unknown,
    addEventListener: (key: string, fn: (e: unknown) => void) =>
      listeners.set("document:" + key, fn),
    removeEventListener: (key: string) => listeners.delete("document:" + key),
  };
  const first = {
      focus: () => {
        doc.activeElement = first;
      },
    },
    last = {
      focus: () => {
        doc.activeElement = last;
      },
    },
    before = {
      focus: () => {
        doc.activeElement = before;
      },
    };
  doc.activeElement = before;
  const drawer = {
    querySelector: () => first,
    querySelectorAll: () => [first, last],
  };
  const pending: (() => void)[] = [];
  const cleanups = new Map<number, () => void>();
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
    useRef(current: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current };
      return slots[index];
    },
    useEffect(effect: () => unknown, deps: unknown[]) {
      const index = cursor++,
        old = slots[index] as unknown[] | undefined;
      if (!old || deps.some((value, i) => value !== old[i])) {
        slots[index] = deps;
        pending.push(() => {
          cleanups.get(index)?.();
          const cleanup = effect();
          if (typeof cleanup === "function")
            cleanups.set(index, cleanup as () => void);
          else cleanups.delete(index);
        });
      }
    },
  };
  const jsx = (type: unknown, props: Record<string, unknown>) => {
    if (props.ref)
      (props.ref as { current: unknown }).current =
        type === "aside" ? drawer : before;
    return { type, props };
  };
  const runtime = { jsx, jsxs: jsx };
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
    localStorage: {
      getItem: (key: string) => preferences.get(key),
      setItem: (key: string, value: string) => preferences.set(key, value),
    },
    sessionStorage: { removeItem: () => {} },
    document: doc,
    AbortController,
    require: (name: string) => {
      if (name === "react") return hooks;
      if (name === "react/jsx-runtime") return runtime;
      if (name === "./api")
        return {
          pendingRequest: () => null,
          api: async () => ({
            conversations: [],
            tasks: [],
            nextCursor: null,
            agent: null,
            answerModel: "",
          }),
          errorText: () => "fixture",
        };
      if (name === "./workspace/navigation") return navExports;
      const key = name.split("/").at(-1)!;
      return { [key]: key };
    },
  });
  return {
    render: () => {
      cursor = 0;
      const result = exports.Workspace!({
        onExpired: () => {},
        username: "synthetic",
        account: null,
      });
      pending.splice(0).forEach((effect) => effect());
      return result;
    },
    preferences,
    doc,
    first,
    last,
    before,
    key: (key: string, shiftKey = false) => {
      const e = { key, shiftKey, preventDefault: jest.fn() };
      listeners.get("document:keydown")?.(e);
      return e;
    },
    resize: (matches: boolean) => {
      media.matches = matches;
      listeners.get("media")?.({});
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
test("small screens start closed, expose modal semantics on open, and close after navigation", () => {
  const h = harness(false);
  let root = h.render();
  expect(all(root).some((n) => n.type === "aside")).toBe(false);
  h.click(all(root).find((n) => n.props["aria-label"] === "메뉴 열기")!);
  root = h.render();
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

test("mobile drawer runs Escape, Tab trap, focus restoration and viewport change effects", () => {
  const h = harness(false);
  let root = h.render();
  const open = () => {
    h.click(all(root).find((n) => n.props["aria-label"] === "메뉴 열기")!);
    root = h.render();
  };
  open();
  expect(h.doc.activeElement).toBe(h.first);
  h.doc.activeElement = h.last;
  expect(h.key("Tab").preventDefault).toHaveBeenCalled();
  expect(h.doc.activeElement).toBe(h.first);
  expect(h.key("Tab", true).preventDefault).toHaveBeenCalled();
  expect(h.doc.activeElement).toBe(h.last);
  h.key("Escape");
  root = h.render();
  expect(all(root).some((n) => n.type === "aside")).toBe(false);
  expect(h.doc.activeElement).toBe(h.before);
  expect(h.preferences.get("townbase.menu-open")).toBe("true");
  open();
  h.resize(true);
  root = h.render();
  expect(root.props.className).toContain("menu-pinned");
  h.resize(false);
  root = h.render();
  expect(all(root).some((n) => n.type === "aside")).toBe(false);
});
