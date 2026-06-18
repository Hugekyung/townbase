import {
  createPrismaClient,
  persistQuestionRetrievalSelection,
  searchDocumentChunksByEmbedding,
  type PrismaClient,
} from "@townbase/database";
import {
  createOpenAIEmbeddingModel,
  type EmbeddingModel,
  type EmbeddingVector,
} from "@townbase/rag-core";

import {
  CHAT_MCP_SERVER_GUIDANCE,
  CHAT_MCP_SERVER_NAME,
  CHAT_MCP_SERVER_VERSION,
} from "./chat.constants";
import type { ChatQuestionExecutionInput } from "./chat.service";
import type { PromptTraceSource } from "@townbase/agent-core";
import type { ChatMcpSurface } from "./chat.server";
import type { RetrievalStrategy } from "@townbase/rag-core";

export type ChatRetrievalRequest = Readonly<{
  workspaceId: string;
  question: string;
  requestedMode: ChatQuestionExecutionInput["mode"];
  resolvedMode: Exclude<ChatQuestionExecutionInput["mode"], "auto">;
  strategy: RetrievalStrategy;
  embedding: readonly number[];
}>;

export type ChatRetrievalExecutor = Readonly<{
  retrieve: (input: ChatRetrievalRequest) => Promise<readonly PromptTraceSource[]>;
}>;

export type ChatCompletionRequest = Readonly<{
  systemPrompt: string;
  promptTemplate: string;
  context: {
    question: string;
    requestedMode: string;
    resolvedMode: string;
    sourceCount: number;
    sourceSummary: string;
    sourceCitations: readonly string[];
  };
  citations: readonly Readonly<{
    rank: number;
    title: string;
    sourceType: string;
    sourceReference: string;
    score: number;
  }>[];
  sourceSummary: string;
}>;

export type ChatCompletionClient = Readonly<{
  model: string;
  complete: (input: ChatCompletionRequest) => Promise<string>;
}>;

export type ChatPersistence = Readonly<{
  persistQuestionTrace: (input: {
    workspaceId: string;
    questionId: string;
    requestedMode: ChatQuestionExecutionInput["mode"];
    resolvedMode: Exclude<ChatQuestionExecutionInput["mode"], "auto">;
    confidence: number;
    isAnswerable: boolean;
    sources: readonly PromptTraceSource[];
  }) => Promise<void>;
}>;

export type ChatTransportSurface = Readonly<{
  describeSurface: () => ChatMcpSurface;
}>;

export type ChatExecutionDependencies = Readonly<{
  prisma: Pick<PrismaClient, "question" | "questionSource" | "documentChunk" | "$transaction">;
  embedding: EmbeddingModel;
  retriever: ChatRetrievalExecutor;
  completion: ChatCompletionClient;
  persistence: ChatPersistence;
  transport: ChatTransportSurface;
}>;

const hashEmbedding = (text: string): readonly number[] => {
  const buffer = Buffer.from(text, "utf8");
  const vector = Array.from({ length: 8 }, (_, index) => {
    const byte = buffer[index % Math.max(buffer.length, 1)] ?? index;
    return Number(((byte % 97) / 97).toFixed(6));
  });

  return vector;
};

export const createFallbackEmbeddingModel = (): EmbeddingModel => ({
  model: "hash-embedding-8",
  async embedText(text: string): Promise<readonly number[]> {
    return hashEmbedding(text);
  },
  async embedTexts(texts: readonly string[]): Promise<readonly EmbeddingVector[]> {
    return texts.map((text) => hashEmbedding(text));
  },
});

export const createDefaultChatDependencies = (): ChatExecutionDependencies => {
  const prisma = createPrismaClient();

  return {
    prisma,
    embedding: process.env.OPENAI_API_KEY
      ? createOpenAIEmbeddingModel({
          apiKey: process.env.OPENAI_API_KEY,
          ...(process.env.OPENAI_EMBEDDING_MODEL === undefined
            ? {}
            : { model: process.env.OPENAI_EMBEDDING_MODEL }),
        })
      : createFallbackEmbeddingModel(),
    retriever: {
      async retrieve(input) {
        const rows = await searchDocumentChunksByEmbedding(prisma, {
          workspaceId: input.workspaceId,
          embedding: input.embedding,
          topK: input.strategy.topK,
        });
        const chunkIds = rows.map((row) => row.id);
        const chunks = await prisma.documentChunk.findMany({
          where: {
            workspaceId: input.workspaceId,
            id: {
              in: chunkIds,
            },
          },
          include: {
            document: true,
          },
        });

        const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));

        return rows.flatMap((row, index) => {
          const chunk = chunkById.get(row.id);

          if (chunk === undefined) {
            return [];
          }

          return [
            {
              documentId: chunk.documentId,
              chunkId: chunk.id,
              sourceType: chunk.sourceType,
              title: chunk.document.title,
              filePath: chunk.document.filePath,
              sourceUrl: chunk.document.url,
              sectionTitle: chunk.sectionTitle ?? null,
              headingPath: Array.isArray(chunk.headingPath) ? chunk.headingPath.map(String) : [],
              rank: index + 1,
              score: row.score,
            },
          ] satisfies readonly PromptTraceSource[];
        });
      },
    },
    completion: {
      model: process.env.OPENAI_CHAT_MODEL ?? "chat-scaffold",
      async complete(input) {
        return JSON.stringify({
          answer: "",
          isAnswerable: false,
          confidence: input.citations.length === 0 ? 0 : 0.25,
          knowledgeGap: input.citations.length === 0 ? "No traced sources selected." : null,
          suggestedFollowups: [],
          tokenUsage: {
            input: 0,
            output: 0,
          },
        });
      },
    },
    persistence: {
      async persistQuestionTrace(input) {
        await persistQuestionRetrievalSelection(prisma, {
          workspaceId: input.workspaceId,
          questionId: input.questionId,
          requestedMode: input.requestedMode,
          resolvedMode: input.resolvedMode,
          confidence: input.confidence,
          isAnswerable: input.isAnswerable,
          sources: input.sources.map((source) => ({
            chunkId: source.chunkId,
            mode: input.resolvedMode,
            rank: source.rank,
            score: source.score,
          })),
        });
      },
    },
    transport: {
      describeSurface() {
        return {
          serverName: CHAT_MCP_SERVER_NAME,
          serverVersion: CHAT_MCP_SERVER_VERSION,
          guidance: CHAT_MCP_SERVER_GUIDANCE,
          transportKind: "stdio",
          tools: [],
        };
      },
    },
  };
};
