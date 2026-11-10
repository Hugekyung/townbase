import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

// Render the real ResultView with inert hooks and collect its visible text.
type Node = { type: unknown; props: Record<string, unknown> };
function resultView() {
  const hooks = {
    useState: <T>(initial: T) => [initial, () => {}],
    useEffect: () => {},
    useLayoutEffect: () => {},
    useRef: () => ({ current: null }),
  };
  const runtime = {
    jsx: (type: unknown, props: Record<string, unknown>) => ({ type, props }),
    jsxs: (type: unknown, props: Record<string, unknown>) => ({ type, props }),
    Fragment: "fragment",
  };
  const exports: Record<string, (props: Record<string, unknown>) => Node> = {};
  const js = ts.transpileModule(
    readFileSync(
      path.resolve(__dirname, "../../web/src/workspace/ChatPanel.tsx"),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    },
  ).outputText;
  vm.runInNewContext(js, {
    exports,
    require: (name: string) => {
      if (name === "react") return hooks;
      if (name === "react/jsx-runtime") return runtime;
      if (name === "../api")
        return {
          api: async () => ({}),
          errorText: () => "error",
          ApiError: class extends Error {},
          download: async () => {},
        };
      if (name === "./model-readiness") return { modelSetupSteps: () => [] };
      if (name === "./Icon") return { Icon: () => null };
      throw Error("Unexpected component require " + name);
    },
  });
  const text = (root: unknown): string[] => {
    if (Array.isArray(root)) return root.flatMap(text);
    if (typeof root === "string") return [root];
    if (root == null || typeof root !== "object") return [];
    const node = root as Node;
    return [
      ...(node.props.className === "tag partial-badge" ? ["<badge>"] : []),
      ...text(node.props.children),
    ];
  };
  return (result: Record<string, unknown>) =>
    text(exports.ResultView!({ result })).join("");
}
const base = {
  requestId: "r",
  question: "q",
  model: "gpt-6-luna",
  errorCode: null,
  sourceState: "available",
  sources: [],
  calls: [],
};
const claim = { text: "접수는 오전 10시입니다.", evidence: [] };
describe("R05 chat result display", () => {
  const render = resultView();
  test("a v2 refusal with verified partial facts is badged, not shown as answered", () => {
    const view = render({
      ...base,
      status: "refused",
      answer: "판단 불가\n\n추가로 확인할 항목:\n- 소득",
      result: {
        contractVersion: 2,
        claims: [claim],
        conflicts: [],
        followUps: ["소득"],
      },
    });
    expect(view).toContain("<badge>일부 근거만 확인");
    expect(view).toContain("찾은 근거로 일부만 확인했어요");
    expect(view).toContain("추가로 확인할 항목");
  });
  test.each([
    ["answered v2", { status: "answered", contractVersion: 2 }],
    [
      "refused v2 without facts",
      { status: "refused", contractVersion: 2, claims: [] },
    ],
    ["stored v1 row", { status: "refused", contractVersion: undefined }],
    [
      "hidden source",
      { status: "refused", contractVersion: 2, sourceState: "unavailable" },
    ],
  ])("%s shows no partial badge", (_name, over) => {
    const {
      status,
      contractVersion,
      claims = [claim],
      sourceState = "available",
    } = over as Record<string, unknown>;
    const view = render({
      ...base,
      status,
      sourceState,
      answer: "답변",
      result: { contractVersion, claims, conflicts: [] },
    });
    expect(view).not.toContain("<badge>");
    expect(view).not.toContain("찾은 근거로 일부만 확인했어요");
  });
});
