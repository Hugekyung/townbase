import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { createHash } from "node:crypto";
import {
  answerText,
  parseRagAnswer,
  type RagSource,
} from "../src/rag/rag-policy";

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
// The positive fixture is produced by the real v2 parser, so the badge is
// exercised only with a refusal the server can actually store.
const sourceId = "11111111-1111-4111-8111-111111111111";
const content = "접수 시간은 오전 10시부터입니다.";
const source: RagSource = {
  id: sourceId,
  indexId: sourceId,
  originalId: sourceId,
  versionId: sourceId,
  scopeRevision: 1,
  content,
  title: "모집공고",
  fileName: "notice.pdf",
  format: "pdf",
  contentHash: "x",
  chunkHash: createHash("sha256").update(content).digest("hex"),
  locations: [
    {
      segment: 0,
      start: 0,
      end: 19,
      location: { page: 16 },
      headingPath: [],
    },
  ],
  headingPath: [],
  sourceType: "uploaded_file",
  knowledgeTypes: ["unknown"],
  domainTags: [],
  status: "active",
  sourcePriority: 50,
  requestedMode: null,
  resolvedMode: null,
  score: 0.8,
  reference: "/files/" + sourceId + "/reference",
};
const partial = parseRagAnswer(
  JSON.stringify({
    isAnswerable: false,
    reason: "찾은 근거로는 소득 기준 충족 여부를 판단할 수 없습니다.",
    claims: [
      {
        text: "접수는 오전 10시에 시작합니다.",
        evidence: [{ sourceId: "S1", quote: "오전 10시부터" }],
      },
    ],
    conflicts: [],
    followUps: ["세대 월평균 소득"],
  }),
  [source],
);
const claim = partial.claims[0]!;
describe("R05 chat result display", () => {
  const render = resultView();
  test("a v2 refusal with verified partial facts is badged, not shown as answered", () => {
    expect(claim.evidence).toEqual([{ sourceId, quote: "오전 10시부터" }]);
    const view = render({
      ...base,
      status: "refused",
      answer: answerText(partial),
      sources: [{ ...source, kind: "file" }],
      result: partial,
    });
    expect(view).toContain("<badge>일부 근거만 확인");
    expect(view).toContain("찾은 근거로 일부만 확인했어요");
    expect(view).toContain("추가로 확인할 항목:\n- 세대 월평균 소득");
    // The verified quote is shown under its numbered source.
    // (JSX splits "출처 {n}개" into separate text children.)
    expect(view).toContain("등록 문서 모집공고16쪽오전 10시부터");
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
