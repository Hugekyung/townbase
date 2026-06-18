import type { PromptTraceSource } from "@townbase/agent-core";

import { generateDraftCandidate } from "../src/knowledge-gaps/draft-generator";

const gap = {
  id: "gap-1",
  workspaceId: "workspace-1",
  questionId: "question-1",
  category: "documentation",
  title: "Documentation gap: How do I add the schema migration",
  description: "No source explains the migration flow.",
  suggestedDocumentTitle: "Document How do I add the schema migration",
  suggestedMarkdownPath: "docs/gaps/documentation-how-do-i-add-the-schema-migration.md",
  suggestedGithubIssueTitle: "Document How do I add the schema migration",
  priority: "medium",
  status: "open",
  similarQuestionCount: 2,
  relatedMode: "documentation_gap",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
} as const;

const sources = [
  {
    documentId: "document-1",
    chunkId: "chunk-1",
    sourceType: "repo_docs",
    title: "README",
    filePath: "README.md",
    sourceUrl: null,
    sectionTitle: "Setup",
    headingPath: ["Setup"],
    rank: 1,
    score: 0.92,
  },
] satisfies readonly PromptTraceSource[];

describe("draft generator", () => {
  it("derives copy-friendly issue, markdown, and notion payloads from the same gap", () => {
    const notionDraft = generateDraftCandidate({
      gap,
      type: "notion_page_text",
      sources,
    });

    expect(notionDraft).toMatchObject({
      requestedType: "notion_page_text",
      persistedType: "notion_page",
      title: "Document How do I add the schema migration",
      acceptanceCriteria: [
        "Describe the gap: Documentation gap: How do I add the schema migration.",
        "Include the related mode (documentation_gap) and priority (medium).",
        "Keep the output copy-friendly and ready to paste without reformatting.",
      ],
      requiredContent: [
        "Gap description: No source explains the migration flow.",
        "Suggested document title: Document How do I add the schema migration",
        "Suggested markdown path: docs/gaps/documentation-how-do-i-add-the-schema-migration.md",
        "Suggested issue title: Document How do I add the schema migration",
        "Draft type: notion_page_text",
      ],
      relatedSources: ["README — Setup (README.md)"],
    });
    expect(notionDraft.body).toContain("## Acceptance Criteria");
    expect(notionDraft.body).toContain("## Related Sources");
    expect(notionDraft.body).toContain("README — Setup (README.md)");

    const issueDraft = generateDraftCandidate({
      gap,
      type: "github_issue",
      sources,
    });

    expect(issueDraft.requestedType).toBe("github_issue");
    expect(issueDraft.persistedType).toBe("github_issue");
    expect(issueDraft.title).toBe("Document How do I add the schema migration");

    const markdownDraft = generateDraftCandidate({
      gap,
      type: "markdown_doc",
      sources,
    });

    expect(markdownDraft.requestedType).toBe("markdown_doc");
    expect(markdownDraft.persistedType).toBe("markdown_doc");
    expect(markdownDraft.body).toContain("# Document How do I add the schema migration");
  });
});
