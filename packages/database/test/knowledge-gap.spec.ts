import {
  listKnowledgeGaps,
  persistKnowledgeGapCandidate,
  updateKnowledgeGapStatus,
  type KnowledgeGapListRow,
  type KnowledgeGapQueryClient,
} from "../src/knowledge-gap";

describe("knowledge gap helpers", () => {
  it("lists gaps with workspace and filter constraints", async () => {
    const gapRow = {
      id: "gap-1",
      workspaceId: "workspace-1",
      questionId: "question-1",
      category: "database",
      title: "Document Phase 1 schema",
      description: null,
      suggestedDocumentTitle: "Phase 1 Database Schema",
      suggestedMarkdownPath: "docs/phase-1-database-schema.md",
      suggestedGithubIssueTitle: "Document Phase 1 database schema",
      priority: "medium",
      status: "open",
      similarQuestionCount: 2,
      relatedMode: "documentation_gap",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    } satisfies KnowledgeGapListRow;

    const findMany = jest.fn(async () => [gapRow]);

    const client: KnowledgeGapQueryClient = {
      knowledgeGap: {
        findMany,
        update: jest.fn(),
      },
    };

    await expect(
      listKnowledgeGaps(client, {
        workspaceId: "workspace-1",
        mode: "documentation_gap",
        category: "database",
        status: "open",
      }),
    ).resolves.toHaveLength(1);

    expect(findMany).toHaveBeenCalledWith({
      where: {
        workspaceId: "workspace-1",
        relatedMode: "documentation_gap",
        category: "database",
        status: "open",
      },
      orderBy: {
        updatedAt: "desc",
      },
    });
  });

  it("updates gap status within the workspace boundary", async () => {
    const gapRow = {
      id: "gap-1",
      workspaceId: "workspace-1",
      questionId: "question-1",
      category: "database",
      title: "Document Phase 1 schema",
      description: null,
      suggestedDocumentTitle: "Phase 1 Database Schema",
      suggestedMarkdownPath: "docs/phase-1-database-schema.md",
      suggestedGithubIssueTitle: "Document Phase 1 database schema",
      priority: "medium",
      status: "drafted",
      similarQuestionCount: 2,
      relatedMode: "documentation_gap",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    } satisfies KnowledgeGapListRow;

    const update = jest.fn(async () => gapRow);

    const client: KnowledgeGapQueryClient = {
      knowledgeGap: {
        findMany: jest.fn(),
        update,
      },
    };

    await expect(
      updateKnowledgeGapStatus(client, {
        workspaceId: "workspace-1",
        knowledgeGapId: "gap-1",
        status: "drafted",
      }),
    ).resolves.toEqual(gapRow);

    expect(update).toHaveBeenCalledWith({
      where: {
        workspaceId_id: {
          workspaceId: "workspace-1",
          id: "gap-1",
        },
      },
      data: {
        status: "drafted",
      },
    });
  });

  it("persists a derived knowledge gap candidate idempotently by question", async () => {
    const gapRow = {
      id: "gap-1",
      workspaceId: "workspace-1",
      questionId: "question-1",
      category: "database",
      title: "Document Phase 1 schema",
      description: "The schema foundation exists, but the implementation details are not yet documented.",
      suggestedDocumentTitle: "Phase 1 Database Schema",
      suggestedMarkdownPath: "docs/gaps/database-phase-1-schema.md",
      suggestedGithubIssueTitle: "Document Phase 1 database schema",
      priority: "high",
      status: "open",
      similarQuestionCount: 3,
      relatedMode: "documentation_gap",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-03T00:00:00.000Z"),
    } satisfies KnowledgeGapListRow;

    const upsert = jest.fn(async () => gapRow);

    const client = {
      knowledgeGap: {
        upsert,
      },
    };

    await expect(
      persistKnowledgeGapCandidate(client, {
        workspaceId: "workspace-1",
        questionId: "question-1",
        category: "database",
        title: "Document Phase 1 schema",
        description: "The schema foundation exists, but the implementation details are not yet documented.",
        suggestedDocumentTitle: "Phase 1 Database Schema",
        suggestedMarkdownPath: "docs/gaps/database-phase-1-schema.md",
        suggestedGithubIssueTitle: "Document Phase 1 database schema",
        priority: "high",
        relatedMode: "documentation_gap",
        similarQuestionCount: 3,
      }),
    ).resolves.toEqual(gapRow);

    expect(upsert).toHaveBeenCalledWith({
      where: {
        workspaceId_questionId: {
          workspaceId: "workspace-1",
          questionId: "question-1",
        },
      },
      create: {
        workspaceId: "workspace-1",
        questionId: "question-1",
        category: "database",
        title: "Document Phase 1 schema",
        description: "The schema foundation exists, but the implementation details are not yet documented.",
        suggestedDocumentTitle: "Phase 1 Database Schema",
        suggestedMarkdownPath: "docs/gaps/database-phase-1-schema.md",
        suggestedGithubIssueTitle: "Document Phase 1 database schema",
        priority: "high",
        similarQuestionCount: 3,
        relatedMode: "documentation_gap",
      },
      update: {
        category: "database",
        title: "Document Phase 1 schema",
        description: "The schema foundation exists, but the implementation details are not yet documented.",
        suggestedDocumentTitle: "Phase 1 Database Schema",
        suggestedMarkdownPath: "docs/gaps/database-phase-1-schema.md",
        suggestedGithubIssueTitle: "Document Phase 1 database schema",
        priority: "high",
        similarQuestionCount: 3,
        relatedMode: "documentation_gap",
      },
    });
  });
});
