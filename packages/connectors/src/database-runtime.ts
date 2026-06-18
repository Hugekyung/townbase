import fs from "node:fs";
import path from "node:path";

export type DatabaseRuntimeModule = Readonly<{
  createPrismaClient: () => {
    $connect: () => Promise<void>;
    document: {
      findUnique: (input: unknown) => Promise<{
        externalUpdatedAt: Date | null;
        contentHash: string | null;
        status: string;
        indexStatus: string;
      } | null>;
      upsert: (input: unknown) => Promise<{ id: string }>;
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
