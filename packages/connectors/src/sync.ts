import path from "node:path";

import { loadNotionConnectorEnv } from "./env";
import { loadDatabaseRuntime } from "./database-runtime";
import { createEmbeddingModel, loadEmbeddingModelEnv } from "./embedding-model";
import { loadNotionSyncFixture } from "./notion/fixture";
import { createPrismaNotionSyncStore } from "./notion/prisma-store";
import { syncNotionPages, type NotionSyncSummary } from "./notion/sync";

type RunNotionSyncOptions = Readonly<{
  fixturePath?: string;
}>;

type DatabaseRuntimeModule = ReturnType<typeof loadDatabaseRuntime>;
type PrismaClientLike = ReturnType<DatabaseRuntimeModule["createPrismaClient"]>;

const resolveFixturePath = (fixturePath: string | undefined): string =>
  fixturePath ?? path.resolve(__dirname, "..", "fixtures", "notion-sync.fixture.json");

const upsertWorkspace = async (
  prisma: PrismaClientLike,
  workspaceName: string,
): Promise<string> => {
  const workspace = await prisma.workspace.upsert({
    where: {
      name: workspaceName,
    },
    update: {},
    create: {
      name: workspaceName,
    },
  });

  return workspace.id;
};

const upsertDataSource = async (
  prisma: PrismaClientLike,
  workspaceId: string,
  dataSourceName: string,
  rootPageId: string,
): Promise<string> => {
  const dataSource = await prisma.dataSource.upsert({
    where: {
      workspaceId_name: {
        workspaceId,
        name: dataSourceName,
      },
    },
    update: {
      type: "notion",
      rootPageId,
      config: {
        rootPageId,
        source: "phase3",
      },
    },
    create: {
      workspaceId,
      type: "notion",
      name: dataSourceName,
      rootPageId,
      config: {
        rootPageId,
        source: "phase3",
      },
    },
  });

  return dataSource.id;
};

const loadOptionalEmbeddingModel = () => {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (apiKey === undefined || apiKey.length === 0) {
    return undefined;
  }

  return createEmbeddingModel(loadEmbeddingModelEnv());
};

export const runNotionSync = async (
  options: RunNotionSyncOptions = {},
): Promise<NotionSyncSummary> => {
  const env = loadNotionConnectorEnv();
  const database = loadDatabaseRuntime(path.resolve(__dirname, "..", "..", "database"));
  const prisma = database.createPrismaClient();
  const fixture = await loadNotionSyncFixture(resolveFixturePath(options.fixturePath));
  const embeddingModel = loadOptionalEmbeddingModel();

  await prisma.$connect();

  try {
    const workspaceId = await upsertWorkspace(
      prisma,
      fixture.workspaceName ?? database.DEFAULT_WORKSPACE_NAME,
    );
    const dataSourceId = await upsertDataSource(
      prisma,
      workspaceId,
      fixture.dataSourceName,
      env.notionRootPageId,
    );

    const summary = await syncNotionPages(
      {
        workspaceId,
        dataSourceId,
        syncedAt: fixture.syncedAt,
        pages: fixture.pages,
        ...(fixture.failures.length === 0 ? {} : { failures: fixture.failures }),
      },
      createPrismaNotionSyncStore(prisma, {
        workspaceId,
        dataSourceId,
        ...(embeddingModel === undefined ? {} : { embeddingModel }),
      }),
      {
        warn: (entry) => {
          process.stderr.write(
            `WARN ${entry.pageId}${entry.pageTitle === undefined ? "" : ` ${entry.pageTitle}`}: ${entry.reason}\n`,
          );
        },
      },
    );

    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return summary;
  } finally {
    await database.disconnectPrismaClient();
  }
};

const main = async (): Promise<void> => {
  await runNotionSync({
    ...(process.env.NOTION_SYNC_FIXTURE_PATH === undefined
      ? {}
      : { fixturePath: process.env.NOTION_SYNC_FIXTURE_PATH }),
  });
};

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
