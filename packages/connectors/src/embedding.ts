import {
  persistDocumentChunkEmbedding,
  listIndexedDocumentChunkIds,
  readDocumentChunkEmbeddingDimensions,
  searchDocumentChunksByEmbedding,
  type DocumentChunkEmbeddingUpsertInput,
  type DocumentChunkVectorSearchInput,
  type VectorSearchRow,
} from "@townbase/database";
import type { EmbeddingModel, EmbeddingVector } from "@townbase/rag-core";

import type { DocumentIndexStatus } from "./document-state";

export type EmbeddableChunk = Readonly<{
  chunkId: string;
  documentId: string;
  content: string;
}>;

export type IndexedChunkEmbedding = Readonly<{
  chunkId: string;
  documentId: string;
  embedding: EmbeddingVector;
}>;

export type ChunkEmbeddingIndexResult =
  | Readonly<{
      kind: "indexed";
      documentId: string;
      chunkCount: number;
    }>
  | Readonly<{
      kind: "failed";
      documentId: string;
      reason: string;
    }>;

export type ChunkEmbeddingSearchInput = Readonly<{
  workspaceId: string;
  question: string;
  topK: number;
  scoreThreshold?: number;
}>;

type PrismaEmbeddingClient = Readonly<{
  $transaction: (arg: unknown, options?: unknown) => Promise<unknown>;
  $queryRaw: <T>(query: unknown) => Promise<T>;
  document: Readonly<{
    update: (input: unknown) => Promise<unknown>;
  }>;
}>;

type PrismaEmbeddingTransactionClient = Readonly<{
  $executeRaw: (query: unknown) => Promise<number>;
  $queryRaw: <T>(query: unknown) => Promise<T>;
}>;

type PrismaEmbeddingQueryClient = Readonly<{
  $queryRaw: <T>(query: unknown) => Promise<T>;
  $executeRaw: (query: unknown) => Promise<number>;
}>;

const embedTexts = async (
  model: EmbeddingModel,
  texts: readonly string[],
): Promise<readonly EmbeddingVector[]> => {
  const embeddings = await model.embedTexts(texts);

  if (embeddings.length !== texts.length) {
    throw new Error("Embedding model returned an unexpected number of vectors");
  }

  return embeddings;
};

const updateDocumentIndexStatus = async (
  prisma: PrismaEmbeddingClient,
  workspaceId: string,
  documentId: string,
  indexStatus: DocumentIndexStatus,
): Promise<void> => {
  await prisma.document.update({
    where: {
      workspaceId_id: {
        workspaceId,
        id: documentId,
      },
    },
    data: {
      indexStatus,
    },
  });
};

export const embedQuestionText = async (
  model: EmbeddingModel,
  question: string,
): Promise<EmbeddingVector> => {
  return model.embedText(question);
};

export const embedDocumentChunks = async (
  model: EmbeddingModel,
  chunks: readonly EmbeddableChunk[],
): Promise<readonly IndexedChunkEmbedding[]> => {
  const embeddings = await embedTexts(
    model,
    chunks.map((chunk) => chunk.content),
  );

  return chunks.map((chunk, index) => {
    const embedding = embeddings[index];

    if (embedding === undefined) {
      throw new Error(`Missing embedding vector for chunk ${chunk.chunkId}`);
    }
    if (embedding.length !== model.dimensions) {
      throw new Error(`Embedding dimension mismatch for chunk ${chunk.chunkId}`);
    }

    return {
      chunkId: chunk.chunkId,
      documentId: chunk.documentId,
      embedding,
    };
  });
};

export const indexDocumentChunks = async (
  prisma: PrismaEmbeddingClient,
  model: EmbeddingModel,
  workspaceId: string,
  documentId: string,
  chunks: readonly EmbeddableChunk[],
): Promise<ChunkEmbeddingIndexResult> => {
  try {
    if (chunks.length === 0) {
      await updateDocumentIndexStatus(prisma, workspaceId, documentId, "indexed");
      return {
        kind: "indexed",
        documentId,
        chunkCount: 0,
      };
    }

    const indexedChunkIds = await listIndexedDocumentChunkIds(
      prisma,
      workspaceId,
      chunks.map(({ chunkId }) => chunkId),
      model.model,
      model.dimensions,
    );
    const indexedChunkIdSet = new Set(indexedChunkIds);
    const pendingChunks = chunks.filter(({ chunkId }) => !indexedChunkIdSet.has(chunkId));

    if (pendingChunks.length === 0) {
      await updateDocumentIndexStatus(prisma, workspaceId, documentId, "indexed");
      return {
        kind: "indexed",
        documentId,
        chunkCount: chunks.length,
      };
    }

    const indexedChunks = await embedDocumentChunks(model, pendingChunks);

    await prisma.$transaction(async (transactionClient: PrismaEmbeddingTransactionClient) => {
      for (const indexedChunk of indexedChunks) {
        const affectedRows = await persistDocumentChunkEmbedding(transactionClient, {
          workspaceId,
          chunkId: indexedChunk.chunkId,
          embedding: indexedChunk.embedding,
          embeddingModel: model.model,
        } satisfies DocumentChunkEmbeddingUpsertInput);

        if (affectedRows !== 1) {
          throw new Error(`Failed to persist embedding for chunk ${indexedChunk.chunkId}`);
        }
      }

      const persistedEmbeddings = await readDocumentChunkEmbeddingDimensions(
        transactionClient,
        workspaceId,
        pendingChunks.map(({ chunkId }) => chunkId),
      );
      const persistedEmbeddingDimensions = new Map(
        persistedEmbeddings.map(({ id, dimensions }) => [id, dimensions]),
      );
      for (const chunk of pendingChunks) {
        if (persistedEmbeddingDimensions.get(chunk.chunkId) !== model.dimensions) {
          throw new Error(`Embedding readback failed for chunk ${chunk.chunkId}`);
        }
      }
    });

    await updateDocumentIndexStatus(prisma, workspaceId, documentId, "indexed");
    return {
      kind: "indexed",
      documentId,
      chunkCount: indexedChunks.length,
    };
  } catch (error: unknown) {
    await updateDocumentIndexStatus(prisma, workspaceId, documentId, "failed");
    return {
      kind: "failed",
      documentId,
      reason: error instanceof Error ? error.message : "Unknown embedding failure",
    };
  }
};

export const searchSimilarChunksForQuestion = async (
  prisma: PrismaEmbeddingQueryClient,
  model: EmbeddingModel,
  input: ChunkEmbeddingSearchInput,
): Promise<readonly VectorSearchRow[]> => {
  const embedding = await embedQuestionText(model, input.question);

  return searchDocumentChunksByEmbedding(prisma, {
    workspaceId: input.workspaceId,
    embedding,
    embeddingModel: model.model,
    dimensions: model.dimensions,
    topK: input.topK,
    ...(input.scoreThreshold === undefined ? {} : { scoreThreshold: input.scoreThreshold }),
  } satisfies DocumentChunkVectorSearchInput);
};
