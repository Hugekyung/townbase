import { ChatToolRegistry } from "../src/chat";
import { createMockKnowledgeGapsService, createMockQuestionService } from "./chat-test-helpers";

describe("MCP knowledge-gap tool", () => {
  it("is discoverable and returns the query/status contract", async () => {
    const knowledgeGapsService = createMockKnowledgeGapsService();
    knowledgeGapsService.list = jest.fn().mockResolvedValue([
      {
        id: "gap-1",
        workspaceId: "workspace-1",
        questionId: "question-1",
        category: "database",
        title: "Documentation gap: How do I add the schema migration",
        description: "No source explains the migration flow.",
        suggestedDocumentTitle: "Document How do I add the schema migration",
        suggestedMarkdownPath: "docs/gaps/database-how-do-i-add-the-schema-migration.md",
        suggestedGithubIssueTitle: "Document How do I add the schema migration",
        priority: "medium",
        status: "open",
        similarQuestionCount: 0,
        relatedMode: "documentation_gap",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);
    const registry = new ChatToolRegistry(
      createMockQuestionService(),
      knowledgeGapsService,
    );

    expect(registry.listTools().map((tool) => tool.name)).toContain(
      "workspace_knowledge.knowledge_gap",
    );

    await expect(
      registry.callTool("workspace_knowledge.knowledge_gap", {
        workspaceId: "workspace-1",
        query: "schema",
      }),
    ).resolves.toMatchObject({
      structuredContent: {
        workspaceId: "workspace-1",
        action: "query",
        query: "schema",
        filters: {},
        gaps: expect.arrayContaining([
          expect.objectContaining({
            id: "gap-1",
            category: "database",
          }),
        ]),
      },
    });
  });

  it("updates gap status through the MCP tool contract", async () => {
    const knowledgeGapsService = createMockKnowledgeGapsService();
    knowledgeGapsService.updateStatus = jest.fn().mockResolvedValue({
      id: "gap-1",
      workspaceId: "workspace-1",
      questionId: "question-1",
      category: "database",
      title: "Documentation gap: How do I add the schema migration",
      description: "No source explains the migration flow.",
      suggestedDocumentTitle: "Document How do I add the schema migration",
      suggestedMarkdownPath: "docs/gaps/database-how-do-i-add-the-schema-migration.md",
      suggestedGithubIssueTitle: "Document How do I add the schema migration",
      priority: "medium",
      status: "drafted",
      similarQuestionCount: 0,
      relatedMode: "documentation_gap",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    });
    const registry = new ChatToolRegistry(
      createMockQuestionService(),
      knowledgeGapsService,
    );

    await expect(
      registry.callTool("workspace_knowledge.knowledge_gap", {
        workspaceId: "workspace-1",
        action: "update_status",
        knowledgeGapId: "gap-1",
        status: "drafted",
      }),
    ).resolves.toMatchObject({
      structuredContent: {
        workspaceId: "workspace-1",
        action: "update_status",
        status: "ok",
        gap: expect.objectContaining({
          id: "gap-1",
          status: "drafted",
        }),
      },
    });
  });
});
