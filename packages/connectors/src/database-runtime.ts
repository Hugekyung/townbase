import fs from "node:fs";
import path from "node:path";

import type { PrismaClient } from "@prisma/client";

export type DatabaseRuntimeModule = Readonly<{
  createPrismaClient: () => {
    $connect: () => Promise<void>;
    $transaction: PrismaClient["$transaction"];
    $queryRaw: PrismaClient["$queryRaw"];
    $executeRaw: PrismaClient["$executeRaw"];
    document: {
      findUnique: (input: unknown) => Promise<{
        id?: string;
        externalUpdatedAt: Date | null;
        contentHash: string | null;
        status: string;
        indexStatus: string;
      } | null>;
      upsert: (input: unknown) => Promise<{ id: string }>;
      update: (input: unknown) => Promise<unknown>;
    };
    documentChunk: {
      deleteMany: (input: unknown) => Promise<unknown>;
      createMany: (input: unknown) => Promise<unknown>;
    };
    workspace: {
      upsert: (input: unknown) => Promise<{ id: string }>;
    };
    dataSource: {
      upsert: (input: unknown) => Promise<{ id: string }>;
      update: (input: unknown) => Promise<unknown>;
    };
    $disconnect?: () => Promise<void>;
  };
  disconnectPrismaClient: () => Promise<void>;
  DEFAULT_WORKSPACE_NAME: string;
}>;

export const resolveDatabaseRuntimePath = (
  databasePackageRoot: string,
  fileExists: (candidatePath: string) => boolean = fs.existsSync,
): string => {
  const builtRuntimePath = path.resolve(databasePackageRoot, "dist", "index.js");

  if (fileExists(builtRuntimePath)) {
    return builtRuntimePath;
  }

  return path.resolve(databasePackageRoot, "src", "index.ts");
};

export const loadDatabaseRuntime = (
  databasePackageRoot: string,
): DatabaseRuntimeModule => {
  const databaseRuntimePath = resolveDatabaseRuntimePath(databasePackageRoot);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(databaseRuntimePath) as DatabaseRuntimeModule;
};
