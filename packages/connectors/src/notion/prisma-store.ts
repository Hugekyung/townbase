import type { NotionPageDraft } from "./mapping";
import type { NotionSyncStore } from "./sync";
import type { DocumentStatus } from "../classification";

type PrismaClientLike = Readonly<{
  document: Readonly<{
    findUnique: (input: unknown) => Promise<{
      externalUpdatedAt: Date | null;
      status: string;
    } | null>;
    upsert: (input: unknown) => Promise<unknown>;
  }>;
  dataSource: Readonly<{
    update: (input: unknown) => Promise<unknown>;
  }>;
}>;

type PrismaNotionStoreContext = Readonly<{
  workspaceId: string;
  dataSourceId: string;
}>;

const normalizeStatus = (status: string): DocumentStatus =>
  status === "archived" || status === "deprecated" ? status : "active";

export const createPrismaNotionSyncStore = (
  prisma: PrismaClientLike,
  context: PrismaNotionStoreContext,
): NotionSyncStore => ({
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
        status: true,
      },
    });

    if (document === null) {
      return null;
    }

      return {
        externalUpdatedAt: document.externalUpdatedAt,
        status: normalizeStatus(document.status),
      };
  },
  async upsertDocument(input: NotionPageDraft) {
    await prisma.document.upsert({
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
        content: input.content,
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
        content: input.content,
        status: input.status,
        knowledgeTypes: [...input.knowledgeTypes],
        domainTags: [...input.domainTags],
        externalCreatedAt: input.externalCreatedAt,
        externalUpdatedAt: input.externalUpdatedAt,
        metadata: input.metadata,
      },
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
