import { KnowledgeGapsService } from "../src/knowledge-gaps/knowledge-gaps.service";

describe("KnowledgeGapsService", () => {
  it("builds a draft from an orphaned source without crashing", async () => {
    const draftRow = {
      id: "draft-1",
      workspaceId: "workspace-1",
      knowledgeGapId: "gap-1",
      type: "github_issue",
      title: "Document the schema flow",
      body: "Draft body",
      status: "draft",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    };

    const prisma = {
      workspace: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: "workspace-1",
        }),
      },
      knowledgeGap: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
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
          question: {
            questionSources: [
              {
                rank: 1,
                score: 0.91,
                chunk: undefined,
              },
            ],
          },
        }),
      },
      actionDraft: {
        upsert: jest.fn().mockResolvedValue(draftRow),
        findMany: jest.fn(),
        deleteMany: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
        findFirstOrThrow: jest.fn(),
      },
    };

    const service = new KnowledgeGapsService(prisma as never);

    await expect(service.createDraft("gap-1", "github_issue", "workspace-1")).resolves.toMatchObject({
      workspaceId: "workspace-1",
      knowledgeGapId: "gap-1",
      requestedType: "github_issue",
      persistedType: "github_issue",
      relatedSources: ["Untitled (unknown)"],
      draft: draftRow,
    });

    expect(prisma.knowledgeGap.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId_id: {
            workspaceId: "workspace-1",
            id: "gap-1",
          },
        },
      }),
    );
    expect(prisma.actionDraft.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId_knowledgeGapId_type: {
            workspaceId: "workspace-1",
            knowledgeGapId: "gap-1",
            type: "github_issue",
          },
        },
      }),
    );
  });
});
