import type { DocumentStatus } from "../classification";
import type { LocalRepoDocumentDraft, LocalRepoSyncStore } from "./types";

type PrismaClientLike = Readonly<{
  document: Readonly<{
    findUnique: (input: Readonly<{
      where: Readonly<{
        dataSourceId_externalId: Readonly<{
          dataSourceId: string;
          externalId: string;
        }>;
      }>;
      select: Readonly<{
        externalUpdatedAt: true;
        status: true;
      }>;
    }>) => Promise<{
      externalUpdatedAt: Date | null;
      status: string;
    } | null>;
    upsert: (input: Readonly<{
      where: Readonly<{
        dataSourceId_externalId: Readonly<{
          dataSourceId: string;
          externalId: string;
        }>;
      }>;
      create: unknown;
      update: unknown;
    }>) => Promise<unknown>;
  }>;
  dataSource: Readonly<{
    update: (input: Readonly<{
      where: Readonly<{
        id: string;
      }>;
      data: Readonly<{
        lastSyncedAt: Date;
      }>;
    }>) => Promise<unknown>;
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
