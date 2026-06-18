import { createHash } from "node:crypto";

import {
  type ActionDraftStatus,
  type DataSourceType,
  type DocumentStatus,
  type GapPriority,
  type GapStatus,
  type KnowledgeType,
  type PrismaClient,
  type RetrievalMode,
  type SourceType,
} from "@prisma/client";

import {
  createPrismaClient,
  DEFAULT_WORKSPACE_NAME,
  disconnectPrismaClient,
} from "../src";

const clearDatabase = async (prisma: PrismaClient): Promise<void> => {
  await prisma.actionDraft.deleteMany();
  await prisma.knowledgeGap.deleteMany();
  await prisma.questionSource.deleteMany();
  await prisma.question.deleteMany();
  await prisma.documentChunk.deleteMany();
  await prisma.document.deleteMany();
  await prisma.dataSource.deleteMany();
};

describe("database integration", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createPrismaClient();
    await prisma.$connect();
  });

  afterEach(async () => {
    await clearDatabase(prisma);
  });

  afterAll(async () => {
    await disconnectPrismaClient();
  });

  it("keeps the seeded workspace available", async () => {
    const workspace = await prisma.workspace.findUnique({
      where: {
        name: DEFAULT_WORKSPACE_NAME,
      },
    });

    expect(workspace?.name).toBe(DEFAULT_WORKSPACE_NAME);
  });

  it("persists a document, chunk, question, gap, and draft round trip", async () => {
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: {
        name: DEFAULT_WORKSPACE_NAME,
      },
    });

    const dataSource = await prisma.dataSource.create({
      data: {
        workspaceId: workspace.id,
        type: "local_repo" satisfies DataSourceType,
        name: "townbase-docs",
        rootPath: "packages/database",
        config: {
          branch: "main",
        },
      },
    });

    const document = await prisma.document.create({
      data: {
        workspaceId: workspace.id,
        dataSourceId: dataSource.id,
        externalId: "phase-1-schema",
        sourceType: "repo_docs" satisfies SourceType,
        title: "Phase 1 schema notes",
        url: null,
        filePath: "packages/database/README.md",
        repoName: "townbase",
        content: "Phase 1 defines the Prisma-backed database foundation.",
        contentHash: createHash("sha256")
          .update("Phase 1 defines the Prisma-backed database foundation.")
          .digest("hex"),
        status: "active" satisfies DocumentStatus,
        indexStatus: "pending",
        knowledgeTypes: ["architecture", "database"] satisfies KnowledgeType[],
        domainTags: ["phase-1", "database"],
        metadata: {
          scope: "phase-1",
        },
      },
    });

    const chunk = await prisma.documentChunk.create({
      data: {
        workspaceId: workspace.id,
        documentId: document.id,
        content: "Phase 1 defines the Prisma-backed database foundation.",
        sourceType: "repo_docs" satisfies SourceType,
        chunkType: "markdown",
        chunkIndex: 0,
        sectionTitle: "Phase 1 schema notes",
        headingPath: ["Phase 1 schema notes"],
        contentHash: createHash("sha256")
          .update("Phase 1 defines the Prisma-backed database foundation.")
          .digest("hex"),
        knowledgeTypes: ["architecture", "database"] satisfies KnowledgeType[],
        domainTags: ["phase-1", "database"],
        sourcePriority: 1,
        tokenCount: 10,
        metadata: {
          chunkIndex: 0,
        },
      },
    });

    const question = await prisma.question.create({
      data: {
        workspaceId: workspace.id,
        question: "What does Phase 1 add?",
        answer: "It adds the Prisma-backed persistence foundation.",
        requestedMode: "auto" satisfies RetrievalMode,
        resolvedMode: "documentation_gap" satisfies RetrievalMode,
        confidence: 0.92,
        isAnswerable: true,
      },
    });

    const source = await prisma.questionSource.create({
      data: {
        workspaceId: workspace.id,
        questionId: question.id,
        chunkId: chunk.id,
        score: 0.91,
        rank: 1,
        mode: "documentation_gap" satisfies RetrievalMode,
      },
    });

    const gap = await prisma.knowledgeGap.create({
      data: {
        workspaceId: workspace.id,
        questionId: question.id,
        category: "database",
        title: "Document Phase 1 schema",
        description: "The schema foundation exists, but the implementation details are not yet documented.",
        suggestedDocumentTitle: "Phase 1 Database Schema",
        suggestedMarkdownPath: "docs/phase-1-database-schema.md",
        suggestedGithubIssueTitle: "Document Phase 1 database schema",
        priority: "medium" satisfies GapPriority,
        status: "open" satisfies GapStatus,
        similarQuestionCount: 2,
        relatedMode: "documentation_gap" satisfies RetrievalMode,
      },
    });

    const draft = await prisma.actionDraft.create({
      data: {
        workspaceId: workspace.id,
        knowledgeGapId: gap.id,
        type: "markdown_doc",
        title: gap.suggestedDocumentTitle,
        body: "Draft the Phase 1 schema documentation.",
        status: "draft" satisfies ActionDraftStatus,
      },
    });

    const loadedQuestion = await prisma.question.findUniqueOrThrow({
      where: {
        id: question.id,
      },
      include: {
        knowledgeGap: {
          include: {
            actionDrafts: true,
          },
        },
      },
    });
    const questionSources = await prisma.questionSource.findMany({
      where: {
        questionId: question.id,
      },
    });

    expect(questionSources).toHaveLength(1);
    expect(questionSources[0]?.id).toBe(source.id);
    expect(loadedQuestion.knowledgeGap?.id).toBe(gap.id);
    expect(loadedQuestion.knowledgeGap?.actionDrafts).toHaveLength(1);
    expect(loadedQuestion.knowledgeGap?.actionDrafts[0]?.id).toBe(draft.id);

    const persistedDocument = await prisma.document.findUniqueOrThrow({
      where: {
        id: document.id,
      },
    });

    expect(persistedDocument.contentHash).toBe(
      createHash("sha256")
        .update("Phase 1 defines the Prisma-backed database foundation.")
        .digest("hex"),
    );
    expect(persistedDocument.indexStatus).toBe("pending");
  });
});
