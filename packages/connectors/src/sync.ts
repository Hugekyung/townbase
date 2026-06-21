import path from "node:path";

import { loadNotionConnectorEnv } from "./env";
import { loadDatabaseRuntime } from "./database-runtime";
import { createOptionalEmbeddingModel } from "./embedding-model";
import { createPrismaNotionSyncStore } from "./notion/prisma-store";
import { loadNotionSyncFixture } from "./notion/fixture";
import { loadLiveNotionSyncPages } from "./notion/live-sync";
import { syncNotionPages, type NotionSyncSummary } from "./notion/sync";

type RunNotionSyncOptions = Readonly<{
  fixturePath?: string;
}>;

type DatabaseRuntimeModule = ReturnType<typeof loadDatabaseRuntime>;
type PrismaClientLike = ReturnType<DatabaseRuntimeModule["createPrismaClient"]>;

export const resolveNotionSyncFixturePath = (
  argv: ReadonlyArray<string>,
): string | undefined => {
  const normalizeFixturePath = (
    value: string | undefined,
    errorMessage: string,
  ): string | undefined => {
    if (value === undefined) {
      throw new Error(errorMessage);
    }

    const trimmed = value.trim();
    if (trimmed === "") {
      throw new Error(errorMessage);
    }

    if (trimmed.startsWith("-")) {
      throw new Error(errorMessage);
    }

    return trimmed;
  };

  const longFormIndex = argv.findIndex((arg) => arg === "--fixture-path");
  if (longFormIndex !== -1) {
    return normalizeFixturePath(
      argv[longFormIndex + 1],
      "A valid fixture path must be specified after --fixture-path",
    );
  }

  const inlineArg = argv.find((arg) => arg.startsWith("--fixture-path="));
  if (inlineArg !== undefined) {
    return normalizeFixturePath(
      inlineArg.slice("--fixture-path=".length),
      "A valid fixture path must be specified for --fixture-path=",
    );
  }

  return undefined;
};

const resolveFixturePath = (fixturePath: string | undefined): string =>
  fixturePath === undefined
    ? path.resolve(__dirname, "..", "fixtures", "notion-sync.fixture.json")
    : path.isAbsolute(fixturePath)
      ? fixturePath
      : path.resolve(__dirname, "../../../", fixturePath);

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

export const runNotionSync = async (
  options: RunNotionSyncOptions = {},
): Promise<NotionSyncSummary> => {
  const env = loadNotionConnectorEnv();
  const database = loadDatabaseRuntime(path.resolve(__dirname, "..", "..", "database"));
  const prisma = database.createPrismaClient();
  const embeddingModel = createOptionalEmbeddingModel();
  const livePages = options.fixturePath === undefined
    ? await loadLiveNotionSyncPages(env.notionApiKey, env.notionRootPageId)
    : undefined;
  const fixture = options.fixturePath === undefined
    ? undefined
    : await loadNotionSyncFixture(resolveFixturePath(options.fixturePath));

  await prisma.$connect();

  try {
    const workspaceId = await upsertWorkspace(
      prisma,
      fixture?.workspaceName ?? database.DEFAULT_WORKSPACE_NAME,
    );
    const dataSourceId = await upsertDataSource(
      prisma,
      workspaceId,
      fixture?.dataSourceName ?? "notion-connector",
      fixture?.rootPageId ?? env.notionRootPageId,
    );

    const summary = await syncNotionPages(
      {
        workspaceId,
        dataSourceId,
        syncedAt: fixture?.syncedAt ?? new Date(),
        pages: fixture?.pages ?? livePages ?? [],
        ...(fixture === undefined || fixture.failures.length === 0 ? {} : { failures: fixture.failures }),
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
  const fixturePath = resolveNotionSyncFixturePath(process.argv.slice(2));
  await runNotionSync(
    fixturePath === undefined ? {} : { fixturePath },
  );
};

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
