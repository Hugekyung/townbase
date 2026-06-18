import fs from "node:fs";
import path from "node:path";

type PrismaRecord = Readonly<{
  id: string;
}>;

type PrismaWorkspaceDelegate = Readonly<{
  upsert: (input: unknown) => Promise<PrismaRecord>;
}>;

type PrismaTransactionDelegate = (arg: unknown, options?: unknown) => Promise<unknown>;

type PrismaDataSourceDelegate = Readonly<{
  upsert: (input: unknown) => Promise<PrismaRecord>;
  update: (input: unknown) => Promise<unknown>;
}>;

type PrismaDocumentDelegate = Readonly<{
  findUnique: (input: unknown) =>
    Promise<
      | {
          readonly id?: string;
          readonly externalUpdatedAt: Date | null;
          readonly contentHash: string | null;
          readonly status: string;
          readonly indexStatus: string;
        }
      | null
    >;
  upsert: (input: unknown) => Promise<PrismaRecord>;
  update: (input: unknown) => Promise<unknown>;
}>;

type PrismaDocumentChunkDelegate = Readonly<{
  deleteMany: (input: unknown) => Promise<unknown>;
  createMany: (input: unknown) => Promise<unknown>;
}>;

export type PrismaClientLike = Readonly<{
  $connect: () => Promise<void>;
  $disconnect?: () => Promise<void>;
  $transaction: PrismaTransactionDelegate;
  workspace: PrismaWorkspaceDelegate;
  dataSource: PrismaDataSourceDelegate;
  document: PrismaDocumentDelegate;
  documentChunk: PrismaDocumentChunkDelegate;
}>;

export type DatabaseRuntimeModule = Readonly<{
  createPrismaClient: () => PrismaClientLike;
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
