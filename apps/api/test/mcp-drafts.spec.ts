import { ChatToolRegistry } from "../src/chat";
import { createMockKnowledgeGapsService, createMockQuestionService } from "./chat-test-helpers";

describe("MCP draft tool", () => {
  it("is discoverable and creates copy-friendly draft content", async () => {
    const registry = new ChatToolRegistry(
      createMockQuestionService(),
      Object.assign(createMockKnowledgeGapsService(), {
        createDraft: jest.fn().mockResolvedValue({
          workspaceId: "workspace-1",
          knowledgeGapId: "gap-1",
          requestedType: "github_issue",
          persistedType: "github_issue",
          title: "Document the schema flow",
          body: "# Document the schema flow",
          acceptanceCriteria: ["Describe the gap: Document the schema flow."],
          requiredContent: ["Gap description: No source explains the migration flow."],
          relatedSources: ["README.md (document-1)"],
          draft: {
            id: "draft-1",
            workspaceId: "workspace-1",
            knowledgeGapId: "gap-1",
            type: "github_issue",
            title: "Document the schema flow",
            body: "# Document the schema flow",
            status: "draft",
            createdAt: new Date("2026-01-02T00:00:00.000Z"),
            updatedAt: new Date("2026-01-02T00:00:00.000Z"),
          },
        }),
        listDrafts: jest.fn().mockResolvedValue({
          workspaceId: "workspace-1",
          knowledgeGapId: "gap-1",
          drafts: [
            {
              id: "draft-1",
              workspaceId: "workspace-1",
              knowledgeGapId: "gap-1",
              type: "github_issue",
              title: "Document the schema flow",
              body: "# Document the schema flow",
              status: "draft",
              createdAt: new Date("2026-01-02T00:00:00.000Z"),
              updatedAt: new Date("2026-01-02T00:00:00.000Z"),
            },
          ],
        }),
        getDraft: jest.fn().mockResolvedValue({
          workspaceId: "workspace-1",
          knowledgeGapId: "gap-1",
          draft: {
            id: "draft-1",
            workspaceId: "workspace-1",
            knowledgeGapId: "gap-1",
            type: "github_issue",
            title: "Document the schema flow",
            body: "# Document the schema flow",
            status: "draft",
            createdAt: new Date("2026-01-02T00:00:00.000Z"),
            updatedAt: new Date("2026-01-02T00:00:00.000Z"),
          },
        }),
      }),
    );

    expect(registry.listTools().map((tool) => tool.name)).toContain(
      "workspace_knowledge.draft",
    );

    await expect(
      registry.callTool("workspace_knowledge.draft", {
        workspaceId: "workspace-1",
        action: "create",
        knowledgeGapId: "gap-1",
        type: "github_issue",
      }),
    ).resolves.toMatchObject({
      structuredContent: {
        workspaceId: "workspace-1",
        action: "create",
        status: "ok",
        draftCreated: true,
        requestedType: "github_issue",
        persistedType: "github_issue",
      },
    });

    await expect(
      registry.callTool("workspace_knowledge.draft", {
        workspaceId: "workspace-1",
        action: "query",
        knowledgeGapId: "gap-1",
      }),
    ).resolves.toMatchObject({
      structuredContent: {
        workspaceId: "workspace-1",
        action: "query",
        drafts: expect.arrayContaining([
          expect.objectContaining({
            id: "draft-1",
            status: "draft",
          }),
        ]),
      },
    });
  });

  it("rejects malformed draft input", async () => {
    const registry = new ChatToolRegistry(
      createMockQuestionService(),
      createMockKnowledgeGapsService(),
    );

    await expect(
      registry.callTool("workspace_knowledge.draft", {
        workspaceId: "workspace-1",
        action: "create",
        knowledgeGapId: "gap-1",
        type: "unsupported",
      }),
    ).resolves.toEqual({
      content: [
        {
          type: "text",
          text: "type must be one of the supported draft types",
        },
      ],
      isError: true,
    });
  });
});
