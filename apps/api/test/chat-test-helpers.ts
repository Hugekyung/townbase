import { ChatQuestionService } from "../src/chat";

export const createMockQuestionService = (): ChatQuestionService =>
  new ChatQuestionService({
    prisma: {
      question: {
        create: jest.fn(),
      },
      questionSource: {},
      $transaction: jest.fn(),
    } as never,
    embedding: {
      model: "test-embedding",
      embedText: jest.fn(),
      embedTexts: jest.fn(),
    },
    retriever: {
      retrieve: jest.fn(),
    },
    completion: {
      model: "chat-test",
      complete: jest.fn(),
    },
    persistence: {
      persistQuestionTrace: jest.fn(),
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
  } as never);
