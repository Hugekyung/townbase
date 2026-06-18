import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

import {
  createPrismaClient,
  DEFAULT_WORKSPACE_NAME,
  disconnectPrismaClient,
} from "../../database/src";
import type { PrismaClientLike } from "../src/database-runtime";
import { createPrismaLocalRepoSyncStore } from "../src/local-repo/prisma-store";
import {
  collectSelectedLocalRepoFiles,
  syncLocalRepoFiles,
} from "../src/local-repo";

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

      throw new Error("local repo integration test only supports transaction callbacks");
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

describe("local repo connector database integration", () => {
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

  it("writes selected repo docs with file metadata into PostgreSQL", async () => {
    const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "tmp-local-repo-db-"));

    try {
      await fs.mkdir(path.join(rootPath, "repo-a", "docs"), { recursive: true });
      await fs.mkdir(path.join(rootPath, "repo-b", "docs"), { recursive: true });

      const initialReadme = "# Repo A\nintro text\n";
      await fs.writeFile(path.join(rootPath, "repo-a", "README.md"), initialReadme);
      await fs.writeFile(path.join(rootPath, "repo-a", "docs", "guide.md"), "# Guide\n");
      await fs.writeFile(path.join(rootPath, "repo-b", "README.md"), "# Repo B\n");

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
            name: "local-repos",
          },
        },
        update: {
          type: "local_repo",
          rootPath,
          config: {
            selectedRepoNames: ["repo-a"],
          },
        },
        create: {
          workspaceId: workspace.id,
          type: "local_repo",
          name: "local-repos",
          rootPath,
          config: {
            selectedRepoNames: ["repo-a"],
          },
        },
      });

      const files = await collectSelectedLocalRepoFiles(rootPath, ["repo-a"]);
      const store = createPrismaLocalRepoSyncStore(createPrismaClientLike(prisma), {
        workspaceId: workspace.id,
        dataSourceId: dataSource.id,
      });
      const result = await syncLocalRepoFiles(
        {
          workspaceId: workspace.id,
          dataSourceId: dataSource.id,
          syncedAt: new Date("2024-01-10T00:00:00.000Z"),
          files,
        },
        store,
      );

      const persistedDataSource = await prisma.dataSource.findUniqueOrThrow({
        where: {
          id: dataSource.id,
        },
      });
      const repoADocument = await prisma.document.findUniqueOrThrow({
        where: {
          dataSourceId_externalId: {
            dataSourceId: dataSource.id,
            externalId: "repo-a:README.md",
          },
        },
      });
      const repoBDocument = await prisma.document.findUnique({
        where: {
          dataSourceId_externalId: {
            dataSourceId: dataSource.id,
            externalId: "repo-b:README.md",
          },
        },
      });

      expect(result).toEqual({
        inserted: 2,
        updated: 0,
        archived: 0,
        skippedUnchanged: 0,
        failed: 0,
        failures: [],
      });
      expect(persistedDataSource.type).toBe("local_repo");
      expect(persistedDataSource.rootPath).toBe(rootPath);
      expect(persistedDataSource.lastSyncedAt?.toISOString()).toBe(
        "2024-01-10T00:00:00.000Z",
      );
      expect(repoADocument.filePath).toBe("README.md");
      expect(repoADocument.repoName).toBe("repo-a");
      expect(repoADocument.sourceType).toBe("repo_readme");
      expect(repoADocument.knowledgeTypes).toEqual(["onboarding"]);
      expect(repoADocument.contentHash).toBe(createHash("sha256").update(initialReadme).digest("hex"));
      expect(repoADocument.indexStatus).toBe("pending");
      expect(repoBDocument).toBeNull();

      const persistedChunks = await prisma.documentChunk.findMany({
        where: {
          documentId: repoADocument.id,
        },
        orderBy: {
          chunkIndex: "asc",
        },
      });

      expect(persistedChunks).toHaveLength(1);
      expect(persistedChunks[0]).toMatchObject({
        documentId: repoADocument.id,
        chunkIndex: 0,
        sectionTitle: "Repo A",
        headingPath: ["Repo A"],
        sourceType: "repo_readme",
        chunkType: "markdown_section",
        content: "intro text",
        tokenCount: 2,
        sourcePriority: 1,
      });

      await fs.writeFile(path.join(rootPath, "repo-a", "README.md"), "# Repo A updated\nupdated text\n");

      const updatedFiles = await collectSelectedLocalRepoFiles(rootPath, ["repo-a"]);
      await syncLocalRepoFiles(
        {
          workspaceId: workspace.id,
          dataSourceId: dataSource.id,
          syncedAt: new Date("2024-01-11T00:00:00.000Z"),
          files: updatedFiles,
        },
        store,
      );

      const updatedChunks = await prisma.documentChunk.findMany({
        where: {
          documentId: repoADocument.id,
        },
        orderBy: {
          chunkIndex: "asc",
        },
      });

      expect(updatedChunks).toHaveLength(1);
      expect(updatedChunks[0]?.id).not.toBe(persistedChunks[0]?.id);
      expect(updatedChunks[0]).toMatchObject({
        content: "updated text",
        chunkIndex: 0,
      });
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });
});
