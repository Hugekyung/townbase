import path from "node:path";

import {
  loadDatabaseRuntime,
  type DatabaseRuntimeModule,
} from "../database-runtime";

import { collectSelectedLocalRepoFiles } from "./scan";
import { createPrismaLocalRepoSyncStore } from "./prisma-store";
import { syncLocalRepoFiles } from "./sync";
import type { LocalRepoSyncSummary } from "./types";

type PrismaClientLike = ReturnType<DatabaseRuntimeModule["createPrismaClient"]>;

type RunLocalRepoSyncOptions = Readonly<{
  repoRootPath?: string;
  selectedRepoNames?: ReadonlyArray<string>;
  workspaceName?: string;
  dataSourceName?: string;
  databaseRuntime?: DatabaseRuntimeModule;
}>;

type ParsedLocalRepoSyncArgs = Readonly<{
  repoRootPath?: string;
  selectedRepoNames?: ReadonlyArray<string>;
}>;

const DEFAULT_LOCAL_REPO_DATA_SOURCE_NAME = "local-repos";

const resolveRepoRootPath = (repoRootPath: string | undefined): string =>
  path.resolve(process.cwd(), repoRootPath ?? process.env.REPO_ROOT_PATH ?? "./repos");

const readSelectedRepoNames = (selectedRepoNames: ReadonlyArray<string> | undefined): ReadonlyArray<string> => {
  if (selectedRepoNames !== undefined) {
    return selectedRepoNames;
  }

  const envValue = process.env.LOCAL_REPO_NAMES;

  if (envValue === undefined || envValue.trim() === "") {
    throw new Error("Missing required environment variable: LOCAL_REPO_NAMES");
  }

  return Array.from(
    new Set(
      envValue
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value !== ""),
    ),
  );
};

const parseLocalRepoSyncArgs = (argv: ReadonlyArray<string>): ParsedLocalRepoSyncArgs => {
  let repoRootPath: string | undefined;
  const selectedRepoNames: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === undefined) {
      throw new Error("Missing local repo sync argument");
    }

    if (token === "--root-path") {
      const value = argv[index + 1];

      if (value === undefined) {
        throw new Error("Missing value for --root-path");
      }

      repoRootPath = value;
      index += 1;
      continue;
    }

    if (token === "--repo") {
      const value = argv[index + 1];

      if (value === undefined) {
        throw new Error("Missing value for --repo");
      }

      selectedRepoNames.push(value);
      index += 1;
      continue;
    }

    if (token.startsWith("--root-path=")) {
      repoRootPath = token.slice("--root-path=".length);
      continue;
    }

    if (token.startsWith("--repo=")) {
      const value = token.slice("--repo=".length);

      if (value.trim() !== "") {
        selectedRepoNames.push(value);
      }

      continue;
    }

    if (token.startsWith("--repos=")) {
      const value = token.slice("--repos=".length);

      if (value.trim() !== "") {
        selectedRepoNames.push(
          ...value
            .split(",")
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0),
        );
      }

      continue;
    }

    if (!token.startsWith("-")) {
      selectedRepoNames.push(token);
      continue;
    }

    throw new Error(`Unknown local repo sync argument: ${token}`);
  }

  return {
    ...(repoRootPath === undefined ? {} : { repoRootPath }),
    ...(selectedRepoNames.length === 0 ? {} : { selectedRepoNames }),
  };
};

const upsertWorkspace = async (prisma: PrismaClientLike, workspaceName: string): Promise<string> => {
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
  repoRootPath: string,
  selectedRepoNames: ReadonlyArray<string>,
): Promise<string> => {
  const dataSource = await prisma.dataSource.upsert({
    where: {
      workspaceId_name: {
        workspaceId,
        name: dataSourceName,
      },
    },
    update: {
      type: "local_repo",
      rootPath: repoRootPath,
      config: {
        source: "phase4",
        repoRootPath,
        selectedRepoNames,
      },
    },
    create: {
      workspaceId,
      type: "local_repo",
      name: dataSourceName,
      rootPath: repoRootPath,
      config: {
        source: "phase4",
        repoRootPath,
        selectedRepoNames,
      },
    },
  });

  return dataSource.id;
};

export const runLocalRepoSync = async (
  options: RunLocalRepoSyncOptions = {},
): Promise<LocalRepoSyncSummary> => {
  const database =
    options.databaseRuntime ??
    loadDatabaseRuntime(path.resolve(__dirname, "..", "..", "..", "database"));
  const prisma = database.createPrismaClient();
  const repoRootPath = resolveRepoRootPath(options.repoRootPath);
  const selectedRepoNames = readSelectedRepoNames(options.selectedRepoNames);
  const workspaceName = options.workspaceName ?? database.DEFAULT_WORKSPACE_NAME;
  const dataSourceName = options.dataSourceName ?? DEFAULT_LOCAL_REPO_DATA_SOURCE_NAME;

  await prisma.$connect();

  try {
    const workspaceId = await upsertWorkspace(prisma, workspaceName);
    const dataSourceId = await upsertDataSource(
      prisma,
      workspaceId,
      dataSourceName,
      repoRootPath,
      selectedRepoNames,
    );
    const files = await collectSelectedLocalRepoFiles(repoRootPath, selectedRepoNames);
    const summary = await syncLocalRepoFiles(
      {
        workspaceId,
        dataSourceId,
        syncedAt: new Date(),
        files,
      },
      createPrismaLocalRepoSyncStore(prisma, {
        workspaceId,
        dataSourceId,
      }),
    );

    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return summary;
  } finally {
    await database.disconnectPrismaClient();
  }
};

const main = async (): Promise<void> => {
  const parsed = parseLocalRepoSyncArgs(process.argv.slice(2));
  await runLocalRepoSync({
    ...(parsed.repoRootPath === undefined
      ? process.env.REPO_ROOT_PATH === undefined
        ? {}
        : { repoRootPath: process.env.REPO_ROOT_PATH }
      : { repoRootPath: parsed.repoRootPath }),
    ...(parsed.selectedRepoNames === undefined
      ? process.env.LOCAL_REPO_NAMES === undefined
        ? {}
        : { selectedRepoNames: readSelectedRepoNames(undefined) }
      : { selectedRepoNames: parsed.selectedRepoNames }),
  });
};

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
