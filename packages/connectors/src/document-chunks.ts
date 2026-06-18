import { chunkDocument, type ChunkingDocument, type ChunkingMetadata } from "@townbase/rag-core";
import type { Prisma, PrismaClient } from "@prisma/client";

import type { KnowledgeType, SourceType, DocumentStatus } from "./classification";

const DEFAULT_CHUNK_SOURCE_PRIORITY = 1;

type ChunkableDocumentDraft = Readonly<{
  sourceType: SourceType;
  content: string;
  knowledgeTypes: readonly KnowledgeType[];
  domainTags: readonly string[];
  metadata: ChunkingMetadata;
  status: DocumentStatus;
}>;

type PrismaDocumentChunkWriteClient = Pick<Prisma.TransactionClient, "documentChunk">;

type PrismaDocumentChunkClient = Readonly<{
  $transaction: PrismaClient["$transaction"];
}>;

export const buildChunkingDocument = (
  documentId: string,
  draft: ChunkableDocumentDraft,
): ChunkingDocument => ({
  documentId,
  sourceType: draft.sourceType,
  content: draft.content,
  sectionTitle: null,
  headingPath: [],
  contentHash: null,
  knowledgeTypes: draft.knowledgeTypes,
  domainTags: draft.domainTags,
  metadata: draft.metadata,
  status: draft.status,
  sourcePriority: DEFAULT_CHUNK_SOURCE_PRIORITY,
  requestedMode: null,
  resolvedMode: null,
});

export const replaceDocumentChunksInTransaction = async (
  prisma: PrismaDocumentChunkWriteClient,
  workspaceId: string,
  documentId: string,
  draft: ChunkableDocumentDraft,
): Promise<void> => {
  const chunks = chunkDocument(buildChunkingDocument(documentId, draft));

  await prisma.documentChunk.deleteMany({
    where: {
      workspaceId,
      documentId,
    },
  });

  if (chunks.length === 0) {
    return;
  }

  await prisma.documentChunk.createMany({
    data: chunks.map((chunk) => ({
      id: chunk.chunkId,
      workspaceId,
      documentId,
      content: chunk.content,
      sourceType: chunk.sourceType,
      chunkType: chunk.chunkType,
      chunkIndex: chunk.chunkIndex,
      sectionTitle: chunk.sectionTitle,
      headingPath: [...chunk.headingPath],
      contentHash: chunk.contentHash,
      knowledgeTypes: [...chunk.knowledgeTypes],
      domainTags: [...chunk.domainTags],
      sourcePriority: chunk.sourcePriority,
      tokenCount: chunk.tokenCount,
      metadata: chunk.metadata,
    }) as Prisma.DocumentChunkCreateManyInput),
  });
};

export const replaceDocumentChunks = async (
  prisma: PrismaDocumentChunkClient,
  workspaceId: string,
  documentId: string,
  draft: ChunkableDocumentDraft,
): Promise<void> =>
  prisma.$transaction(async (transactionClient: Prisma.TransactionClient) =>
    replaceDocumentChunksInTransaction(transactionClient, workspaceId, documentId, draft),
  );
