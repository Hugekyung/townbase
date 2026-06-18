import { ChatQuestionService } from "../src/chat";
import type { ChatQuestionExecutionResult } from "../src/chat";

const createService = (
  overrides: Partial<ConstructorParameters<typeof ChatQuestionService>[0]> = {},
) => {
  const questionCreate = jest.fn().mockResolvedValue({ id: "question-1" });
  const persistQuestionTrace = jest.fn().mockResolvedValue(undefined);

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
      embedText: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      embedTexts: jest.fn(),
    },
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
      complete: jest.fn().mockResolvedValue(
        JSON.stringify({
          answer: "Use pnpm dev.",
          isAnswerable: true,
          confidence: 0.82,
          knowledgeGap: null,
          suggestedFollowups: ["How do I run tests?"],
          tokenUsage: {
            input: 12,
            output: 7,
          },
        }),
      ),
    },
    persistence: {
      persistQuestionTrace,
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
  };
};

describe("ChatQuestionService", () => {
  it("executes the source-grounded question flow and persists observability rows", async () => {
    const { service, questionCreate, persistQuestionTrace } = createService();

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
  });

  it("returns a deterministic non-answerable fallback when the retriever returns no sources", async () => {
    const { service } = createService({
      retriever: {
        retrieve: jest.fn().mockResolvedValue([]),
      },
      completion: {
        model: "chat-test",
        complete: jest.fn().mockResolvedValue(
          JSON.stringify({
            answer: "",
            isAnswerable: false,
            confidence: 0.15,
            knowledgeGap: "No sources selected.",
            suggestedFollowups: [],
            tokenUsage: {
              input: 0,
              output: 0,
            },
          }),
        ),
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
  });
});
