import type { DocumentStatus } from "../classification";
import type { LocalRepoDocumentDraft, LocalRepoSyncStore } from "./types";

type PrismaClientLike = Readonly<{
  document: Readonly<{
    findUnique: (input: any) => Promise<{
      externalUpdatedAt: Date | null;
      status: string;
    } | null>;
    upsert: (input: any) => Promise<unknown>;
  }>;
  dataSource: Readonly<{
    update: (input: any) => Promise<unknown>;
  }>;
}>;

type LocalRepoStoreContext = Readonly<{
  workspaceId: string;
  dataSourceId: string;
}>;

const normalizeStatus = (status: string): DocumentStatus =>
  status === "archived" || status === "deprecated" || status === "draft" ? status : "active";

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
  async upsertDocument(input: LocalRepoDocumentDraft) {
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
        filePath: input.filePath,
        repoName: input.repoName,
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
        filePath: input.filePath,
        repoName: input.repoName,
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
