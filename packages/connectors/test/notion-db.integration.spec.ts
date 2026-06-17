import { createHash } from "node:crypto";

import {
  createPrismaClient,
  DEFAULT_WORKSPACE_NAME,
  disconnectPrismaClient,
} from "../../database/src";

import { syncNotionPages } from "../src/notion/sync";

const clearDatabase = async (prisma: ReturnType<typeof createPrismaClient>): Promise<void> => {
  await prisma.document.deleteMany();
  await prisma.dataSource.deleteMany();
};

describe("notion connector database integration", () => {
  const prisma = createPrismaClient();

  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    await clearDatabase(prisma);
  });

  afterEach(async () => {
    await clearDatabase(prisma);
  });

  afterAll(async () => {
    await disconnectPrismaClient();
  });

  it("writes notion data source and document rows into PostgreSQL", async () => {
    const workspace = await prisma.workspace.upsert({
      where: {
        name: DEFAULT_WORKSPACE_NAME,
      },
      update: {},
      create: {
        name: DEFAULT_WORKSPACE_NAME,
      },
    });

    const dataSource = await prisma.dataSource.upsert({
      where: {
        workspaceId_name: {
          workspaceId: workspace.id,
          name: "notion-connector",
        },
      },
      update: {
        type: "notion",
        rootPageId: "root-page",
        config: {
          phase: 3,
        },
      },
      create: {
        workspaceId: workspace.id,
        type: "notion",
        name: "notion-connector",
        rootPageId: "root-page",
        config: {
          phase: 3,
        },
      },
    });

    const syncedAt = new Date("2024-01-10T00:00:00.000Z");
    const result = await syncNotionPages(
      {
        workspaceId: workspace.id,
        dataSourceId: dataSource.id,
        syncedAt,
        pages: [
          {
            page: {
              id: "page-1",
              title: "Getting Started with Payments",
              url: "https://notion.so/page-1",
              createdTime: "2024-01-01T00:00:00.000Z",
              lastEditedTime: "2024-01-03T01:02:03.000Z",
            },
            content: "Hello world",
            pathSegments: ["Engineering", "Onboarding"],
          },
        ],
      },
      {
        async findDocumentByExternalId(externalId: string) {
          const document = await prisma.document.findUnique({
            where: {
              dataSourceId_externalId: {
                dataSourceId: dataSource.id,
                externalId,
              },
            },
            select: {
              externalUpdatedAt: true,
              status: true,
              contentHash: true,
              indexStatus: true,
            },
          });

          if (document === null) {
            return null;
          }

          return {
            externalUpdatedAt: document.externalUpdatedAt,
            status: document.status === "archived" ? "archived" : "active",
            contentHash: document.contentHash,
            indexStatus: document.indexStatus === "failed" || document.indexStatus === "indexed"
              ? document.indexStatus
              : "pending",
          };
        },
        async upsertDocument(input) {
          await prisma.document.upsert({
            where: {
              dataSourceId_externalId: {
                dataSourceId: dataSource.id,
                externalId: input.externalId,
              },
            },
            create: {
              workspaceId: workspace.id,
              dataSourceId: dataSource.id,
              externalId: input.externalId,
              sourceType: input.sourceType,
              title: input.title,
              url: input.url,
              content: input.content,
              contentHash: input.contentHash,
              status: input.status,
              indexStatus: input.indexStatus,
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
              contentHash: input.contentHash,
              status: input.status,
              indexStatus: input.indexStatus,
              knowledgeTypes: [...input.knowledgeTypes],
              domainTags: [...input.domainTags],
              externalCreatedAt: input.externalCreatedAt,
              externalUpdatedAt: input.externalUpdatedAt,
              metadata: input.metadata,
            },
          });
        },
        async markLastSyncedAt(syncedAtValue: Date) {
          await prisma.dataSource.update({
            where: {
              id: dataSource.id,
            },
            data: {
              lastSyncedAt: syncedAtValue,
            },
          });
        },
      },
      {
        warn: () => undefined,
      },
    );

    const persistedDataSource = await prisma.dataSource.findUniqueOrThrow({
      where: {
        id: dataSource.id,
      },
    });
    const persistedDocument = await prisma.document.findUniqueOrThrow({
      where: {
        dataSourceId_externalId: {
          dataSourceId: dataSource.id,
          externalId: "page-1",
        },
      },
    });

    expect(result).toEqual({
      inserted: 1,
      updated: 0,
      archived: 0,
      skippedUnchanged: 0,
      failed: 0,
      failures: [],
    });
    expect(persistedDataSource.type).toBe("notion");
    expect(persistedDataSource.rootPageId).toBe("root-page");
    expect(persistedDataSource.lastSyncedAt?.toISOString()).toBe(syncedAt.toISOString());
    expect(persistedDocument.sourceType).toBe("notion_page");
    expect(persistedDocument.title).toBe("Getting Started with Payments");
    expect(persistedDocument.externalCreatedAt?.toISOString()).toBe(
      "2024-01-01T00:00:00.000Z",
    );
    expect(persistedDocument.externalUpdatedAt?.toISOString()).toBe(
      "2024-01-03T01:02:03.000Z",
    );
    expect(persistedDocument.contentHash).toBe(
      createHash("sha256").update("Hello world").digest("hex"),
    );
    expect(persistedDocument.indexStatus).toBe("pending");
    expect(persistedDocument.knowledgeTypes).toEqual(["onboarding"]);
    expect(persistedDocument.domainTags).toEqual(["payment", "onboarding"]);
  });
});
