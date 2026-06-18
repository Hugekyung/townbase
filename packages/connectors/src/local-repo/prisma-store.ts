import type { DocumentStatus } from "../classification";
import type { DocumentIndexStatus } from "../document-state";
import { replaceDocumentChunksInTransaction } from "../document-chunks";
import type { LocalRepoDocumentDraft, LocalRepoSyncStore } from "./types";
import type { Prisma } from "@prisma/client";
import type { PrismaClientLike } from "../database-runtime";
import { buildChunkingDocument } from "../document-chunks";
import { chunkDocument } from "@townbase/rag-core";
import { indexDocumentChunks, type EmbeddableChunk } from "../embedding";
import type { EmbeddingModel } from "@townbase/rag-core";

type PrismaDocumentWriteTransactionClient = Prisma.TransactionClient;

type LocalRepoStoreContext = Readonly<{
  workspaceId: string;
  dataSourceId: string;
  embeddingModel?: EmbeddingModel;
}>;

const normalizeStatus = (status: string): DocumentStatus =>
  status === "archived" || status === "deprecated" || status === "draft" ? status : "active";

const normalizeIndexStatus = (indexStatus: string): DocumentIndexStatus =>
  indexStatus === "failed" || indexStatus === "indexed" ? indexStatus : "pending";

export const createPrismaLocalRepoSyncStore = (
  prisma: PrismaClientLike,
  context: LocalRepoStoreContext,
): LocalRepoSyncStore => ({
  async findDocumentByExternalId(externalId: string) {
    const document = await prisma.document.findUnique({
      where: {
        dataSourceId_externalId: {
          dataSourceId: context.dataSourceId,
          externalId,
        },
      },
      select: {
        externalUpdatedAt: true,
        contentHash: true,
        status: true,
        indexStatus: true,
      },
    });

    if (document === null) {
      return null;
    }

    return {
      externalUpdatedAt: document.externalUpdatedAt,
      contentHash: document.contentHash,
      status: normalizeStatus(document.status),
      indexStatus: normalizeIndexStatus(document.indexStatus),
    };
  },
  async upsertDocument(input: LocalRepoDocumentDraft) {
    await prisma.$transaction(async (transactionClient: PrismaDocumentWriteTransactionClient) => {
      const document = await transactionClient.document.upsert({
        where: {
          dataSourceId_externalId: {
            dataSourceId: context.dataSourceId,
            externalId: input.externalId,
          },
        },
        create: {
          workspaceId: context.workspaceId,
          dataSourceId: context.dataSourceId,
          externalId: input.externalId,
          sourceType: input.sourceType,
          title: input.title,
          url: input.url,
          filePath: input.filePath,
          repoName: input.repoName,
          content: input.content,
          contentHash: input.contentHash,
          indexStatus: input.indexStatus,
          status: input.status,
          knowledgeTypes: [...input.knowledgeTypes],
          domainTags: [...input.domainTags],
          externalCreatedAt: input.externalCreatedAt,
          externalUpdatedAt: input.externalUpdatedAt,
          metadata: input.metadata,
        },
        update: {
          sourceType: input.sourceType,
          title: input.title,
          url: input.url,
          filePath: input.filePath,
          repoName: input.repoName,
          content: input.content,
          contentHash: input.contentHash,
          indexStatus: input.indexStatus,
          status: input.status,
          knowledgeTypes: [...input.knowledgeTypes],
          domainTags: [...input.domainTags],
          externalCreatedAt: input.externalCreatedAt,
          externalUpdatedAt: input.externalUpdatedAt,
          metadata: input.metadata,
        },
        select: {
          id: true,
        },
      });

      await replaceDocumentChunksInTransaction(transactionClient, context.workspaceId, document.id, input);
    });

    if (context.embeddingModel === undefined) {
      return;
    }

    const document = await prisma.document.findUnique({
      where: {
        dataSourceId_externalId: {
          dataSourceId: context.dataSourceId,
          externalId: input.externalId,
        },
      },
      select: {
        id: true,
      },
    });

    if (document === null) {
      throw new Error(`Missing persisted document for external ID ${input.externalId}`);
    }

    if (document.id === undefined) {
      throw new Error(`Persisted document ${input.externalId} is missing an id`);
    }

    const chunks: readonly EmbeddableChunk[] = chunkDocument(buildChunkingDocument(document.id, input)).map(
      (chunk) => ({
        chunkId: chunk.chunkId,
        documentId: chunk.documentId,
        content: chunk.content,
      }),
    );

    const result = await indexDocumentChunks(
      prisma,
      context.embeddingModel,
      context.workspaceId,
      document.id,
      chunks,
    );

    if (result.kind === "failed") {
      throw new Error(`Embedding failed for document ${document.id}: ${result.reason}`);
    }
  },
  async markLastSyncedAt(syncedAt: Date) {
    await prisma.dataSource.update({
      where: {
        id: context.dataSourceId,
      },
      data: {
        lastSyncedAt: syncedAt,
      },
    });
  },
});
