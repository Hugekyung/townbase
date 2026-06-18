import { buildCitations } from "../src/citation-builder";
import type { PromptTraceSource } from "../src/prompt-contract";

describe("citation builder", () => {
  it("formats traced sources into stable citations", () => {
    const citations = buildCitations([
      {
        documentId: "doc-1",
        chunkId: "chunk-1",
        sourceType: "repo_docs",
        title: "README",
        filePath: "packages/agent-core/README.md",
        sourceUrl: null,
        sectionTitle: "Intro",
        headingPath: ["Intro"],
        rank: 1,
        score: 0.91,
      },
      {
        documentId: "doc-2",
        chunkId: "chunk-2",
        sourceType: "notion_page",
        title: "Planning Note",
        filePath: null,
        sourceUrl: "https://notion.example/page",
        sectionTitle: null,
        headingPath: [],
        rank: 2,
        score: 0.84,
      },
    ]);

    expect(citations).toEqual([
      {
        rank: 1,
        title: "README",
        sourceType: "repo_docs",
        sourceReference: "packages/agent-core/README.md",
        score: 0.91,
      },
      {
        rank: 2,
        title: "Planning Note",
        sourceType: "notion_page",
        sourceReference: "https://notion.example/page",
        score: 0.84,
      },
    ]);
  });

  it("falls back to document id when filePath and sourceUrl are undefined at runtime", () => {
    const runtimeSource = {
      documentId: "doc-3",
      chunkId: "chunk-3",
      sourceType: "repo_docs",
      title: "Fallback Source",
      filePath: undefined,
      sourceUrl: undefined,
      sectionTitle: null,
      headingPath: [],
      rank: 3,
      score: 0.77,
    } as unknown as PromptTraceSource;

    expect(buildCitations([runtimeSource])).toEqual([
      {
        rank: 3,
        title: "Fallback Source",
        sourceType: "repo_docs",
        sourceReference: "doc-3",
        score: 0.77,
      },
    ]);
  });
});
