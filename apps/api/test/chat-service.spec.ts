import { ChatQuestionService } from "../src/chat";
import type { ChatQuestionExecutionResult } from "../src/chat";

const createService = (
  overrides: Partial<ConstructorParameters<typeof ChatQuestionService>[0]> = {},
) => {
  const questionCreate = jest.fn().mockResolvedValue({ id: "question-1" });
  const persistQuestionTrace = jest.fn().mockResolvedValue(undefined);
  const persistKnowledgeGapCandidate = jest.fn().mockResolvedValue(undefined);
  const complete = jest.fn().mockResolvedValue(
    JSON.stringify({
      answer: "Use pnpm dev.",
      isAnswerable: true,
      confidence: 0.82,
      knowledgeGap: null,
      suggestedFollowups: ["How do I run tests?"],
      tokenUsage: { input: 12, output: 7 },
    }),
  );

  const service = new ChatQuestionService({
    prisma: {
      question: {
        create: questionCreate,
      },
      questionSource: {},
      $transaction: jest.fn(),
    } as never,
    embedding: {
      model: "test-embedding",
      dimensions: 3,
      embedText: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      embedTexts: jest.fn(),
    },
    retrievalExecutionStrategy: "vector_only",
    retriever: {
      retrieve: jest.fn().mockResolvedValue([
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
          score: 0.91,
        },
      ]),
    },
    completion: {
      model: "chat-test",
      complete,
    },
    persistence: {
      persistQuestionTrace,
    },
    knowledgeGapPersistence: {
      persistKnowledgeGapCandidate,
    },
    transport: {
      describeSurface: jest.fn().mockReturnValue({
        serverName: "@townbase/api-chat",
        serverVersion: "0.1.0",
        guidance: "guidance",
        transportKind: "stdio",
        tools: [],
      }),
    },
    ...overrides,
  });

  return {
    service,
    questionCreate,
    persistQuestionTrace,
    persistKnowledgeGapCandidate,
    complete,
  };
};

describe("ChatQuestionService", () => {
  it("executes the source-grounded question flow and persists observability rows", async () => {
    const {
      service,
      questionCreate,
      persistQuestionTrace,
      persistKnowledgeGapCandidate,
    } = createService();

    const result: ChatQuestionExecutionResult = await service.executeQuestion({
      workspaceId: "workspace-1",
      question: "How do I run the workspace locally?",
      mode: "auto",
    });

    expect(result).toMatchObject({
      questionId: "question-1",
      answer: "Use pnpm dev.",
      requestedMode: "auto",
      resolvedMode: "onboarding",
      confidence: expect.any(Number),
      isAnswerable: true,
      knowledgeGapCreated: false,
      model: "chat-test",
      latencyMs: expect.any(Number),
      tokenUsage: {
        input: 12,
        output: 7,
      },
    });
    expect(result.sources).toHaveLength(1);
    expect(questionCreate).toHaveBeenCalledWith({
      data: {
        workspaceId: "workspace-1",
        question: "How do I run the workspace locally?",
        answer: "Use pnpm dev.",
        requestedMode: "auto",
        resolvedMode: "onboarding",
        confidence: expect.any(Number),
        isAnswerable: true,
      },
    });
    expect(persistQuestionTrace).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      questionId: "question-1",
      requestedMode: "auto",
      resolvedMode: "onboarding",
      confidence: expect.any(Number),
      isAnswerable: true,
      sources: [
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
          score: 0.91,
        },
      ],
    });
    expect(persistKnowledgeGapCandidate).not.toHaveBeenCalled();
  });

  it("returns a deterministic non-answerable fallback when the retriever returns no sources", async () => {
    const { service, persistKnowledgeGapCandidate, complete } = createService({
      retriever: {
        retrieve: jest.fn().mockResolvedValue([]),
      },
    });

    await expect(
      service.executeQuestion({
        workspaceId: "workspace-1",
        question: "What is missing from the docs?",
        mode: "auto",
      }),
    ).resolves.toMatchObject({
      requestedMode: "auto",
      resolvedMode: "documentation_gap",
      isAnswerable: false,
      knowledgeGapCreated: true,
      sources: [],
    });

    expect(persistKnowledgeGapCandidate).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      questionId: "question-1",
      category: "documentation",
      title: "Documentation gap: What is missing from the docs",
      description: "The current sources do not fully answer: What is missing from the docs.",
      suggestedDocumentTitle: "Document What is missing from the docs",
      suggestedMarkdownPath: "docs/gaps/documentation-what-is-missing-from-the-docs.md",
      suggestedGithubIssueTitle: "Document What is missing from the docs",
      priority: "high",
      relatedMode: "documentation_gap",
      similarQuestionCount: 0,
    });
    expect(complete).not.toHaveBeenCalled();
  });

  it("rejects low-score sources and persists a knowledge gap", async () => {
    const { service, persistKnowledgeGapCandidate, questionCreate, complete } = createService({
      retriever: {
        retrieve: jest.fn().mockResolvedValue([
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
            score: 0.6,
          },
        ]),
      },
    });

    await expect(
      service.executeQuestion({
        workspaceId: "workspace-1",
        question: "What is missing from the docs?",
        mode: "auto",
      }),
    ).resolves.toMatchObject({
      answer: "",
      isAnswerable: false,
      knowledgeGapCreated: true,
      sources: [],
    });

    expect(questionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          answer: null,
          isAnswerable: false,
        }),
      }),
    );
    expect(persistKnowledgeGapCandidate).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      questionId: "question-1",
      category: "documentation",
      title: "Documentation gap: What is missing from the docs",
      description: "The current sources do not fully answer: What is missing from the docs.",
      suggestedDocumentTitle: "Document What is missing from the docs",
      suggestedMarkdownPath: "docs/gaps/documentation-what-is-missing-from-the-docs.md",
      suggestedGithubIssueTitle: "Document What is missing from the docs",
      priority: "high",
      relatedMode: "documentation_gap",
      similarQuestionCount: 0,
    });
    expect(complete).not.toHaveBeenCalled();
  });
});
