import type { DocumentStatus } from "../classification";
import type { DocumentIndexStatus } from "../document-state";
import { replaceDocumentChunksInTransaction } from "../document-chunks";
import type { LocalRepoDocumentDraft, LocalRepoSyncStore } from "./types";
import type { Prisma, PrismaClient } from "@prisma/client";

type PrismaDocumentWriteTransactionClient = Prisma.TransactionClient;

type PrismaClientLike = Readonly<{
  $transaction: PrismaClient["$transaction"];
  document: Readonly<{
    findUnique: (input: unknown) => Promise<{
      externalUpdatedAt: Date | null;
      contentHash: string | null;
      status: string;
      indexStatus: string;
    } | null>;
    upsert: (input: unknown) => Promise<Readonly<{ id: string }>>;
  }>;
  dataSource: Readonly<{
    update: (input: unknown) => Promise<unknown>;
  }>;
}>;

type LocalRepoStoreContext = Readonly<{
  workspaceId: string;
  dataSourceId: string;
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
