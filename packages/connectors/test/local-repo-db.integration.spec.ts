import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

import {
  createPrismaClient,
  DEFAULT_WORKSPACE_NAME,
  disconnectPrismaClient,
} from "../../database/src";
import {
  collectSelectedLocalRepoFiles,
  syncLocalRepoFiles,
} from "../src/local-repo";

const clearDatabase = async (prisma: ReturnType<typeof createPrismaClient>): Promise<void> => {
  await prisma.documentChunk.deleteMany();
  await prisma.document.deleteMany();
  await prisma.dataSource.deleteMany();
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

      await fs.writeFile(path.join(rootPath, "repo-a", "README.md"), "# Repo A\n");
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
      const result = await syncLocalRepoFiles(
        {
          workspaceId: workspace.id,
          dataSourceId: dataSource.id,
          syncedAt: new Date("2024-01-10T00:00:00.000Z"),
          files,
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
              status: document.status === "archived" ? "archived" : "active",
              indexStatus:
                document.indexStatus === "failed" || document.indexStatus === "indexed"
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
      expect(repoADocument.contentHash).toBe(createHash("sha256").update("# Repo A\n").digest("hex"));
      expect(repoADocument.indexStatus).toBe("pending");
      expect(repoBDocument).toBeNull();
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });
});
