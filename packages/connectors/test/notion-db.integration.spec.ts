import { createHash } from "node:crypto";

import {
  createPrismaClient,
  DEFAULT_WORKSPACE_NAME,
  disconnectPrismaClient,
} from "../../database/src";
import type { PrismaClientLike } from "../src/database-runtime";
import { createPrismaNotionSyncStore } from "../src/notion/prisma-store";

import { syncNotionPages } from "../src/notion/sync";

const clearDatabase = async (prisma: ReturnType<typeof createPrismaClient>): Promise<void> => {
  await prisma.documentChunk.deleteMany();
  await prisma.document.deleteMany();
  await prisma.dataSource.deleteMany();
};

const createPrismaClientLike = (
  prisma: ReturnType<typeof createPrismaClient>,
): PrismaClientLike => {
  const client: PrismaClientLike = {
    async $connect() {
      await prisma.$connect();
    },
    async $transaction(input: unknown) {
      if (typeof input === "function") {
        return input(client as never);
      }

      throw new Error("notion integration test only supports transaction callbacks");
    },
    workspace: {
      async upsert(input: unknown) {
        return prisma.workspace.upsert(input as never);
      },
    },
    dataSource: {
      async upsert(input: unknown) {
        return prisma.dataSource.upsert(input as never);
      },
      async update(input: unknown) {
        return prisma.dataSource.update(input as never);
      },
    },
    document: {
      async findUnique(input: unknown) {
        return prisma.document.findUnique(input as never);
      },
      async upsert(input: unknown) {
        return prisma.document.upsert(input as never);
      },
      async update(input: unknown) {
        return prisma.document.update(input as never);
      },
    },
    documentChunk: {
      async deleteMany(input: unknown) {
        return prisma.documentChunk.deleteMany(input as never);
      },
      async createMany(input: unknown) {
        return prisma.documentChunk.createMany(input as never);
      },
    },
  };

  return client;
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
    const store = createPrismaNotionSyncStore(createPrismaClientLike(prisma), {
      workspaceId: workspace.id,
      dataSourceId: dataSource.id,
    });

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
      store,
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

    const persistedChunks = await prisma.documentChunk.findMany({
      where: {
        documentId: persistedDocument.id,
      },
      orderBy: {
        chunkIndex: "asc",
      },
    });

    expect(persistedChunks).toHaveLength(1);
    expect(persistedChunks[0]).toMatchObject({
      documentId: persistedDocument.id,
      chunkIndex: 0,
      sectionTitle: null,
      headingPath: [],
      content: "Hello world",
      sourceType: "notion_page",
      chunkType: "plain_text",
      tokenCount: 2,
      contentHash: createHash("sha256").update("Hello world").digest("hex"),
      knowledgeTypes: ["onboarding"],
      domainTags: ["payment", "onboarding"],
      sourcePriority: 1,
    });

    await syncNotionPages(
      {
        workspaceId: workspace.id,
        dataSourceId: dataSource.id,
        syncedAt: new Date("2024-01-11T00:00:00.000Z"),
        pages: [
          {
            page: {
              id: "page-1",
              title: "Getting Started with Payments",
              url: "https://notion.so/page-1",
              createdTime: "2024-01-01T00:00:00.000Z",
              lastEditedTime: "2024-01-04T01:02:03.000Z",
            },
            content: "Hello updated world",
            pathSegments: ["Engineering", "Onboarding"],
          },
        ],
      },
      store,
      {
        warn: () => undefined,
      },
    );

    const updatedChunks = await prisma.documentChunk.findMany({
      where: {
        documentId: persistedDocument.id,
      },
      orderBy: {
        chunkIndex: "asc",
      },
    });

    expect(updatedChunks).toHaveLength(1);
    expect(updatedChunks[0]?.id).not.toBe(persistedChunks[0]?.id);
    expect(updatedChunks[0]).toMatchObject({
      content: "Hello updated world",
      chunkIndex: 0,
      sectionTitle: null,
      headingPath: [],
    });
  });
});
