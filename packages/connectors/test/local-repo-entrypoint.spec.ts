import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { DatabaseRuntimeModule } from "../src/database-runtime";
import { runLocalRepoSync, type LocalRepoDocumentDraft } from "../src";

type LocalRepoUpsertInput = Readonly<{
  create: LocalRepoDocumentDraft;
}>;

const isLocalRepoUpsertInput = (input: unknown): input is LocalRepoUpsertInput =>
  typeof input === "object" && input !== null && "create" in input;

describe("runLocalRepoSync", () => {
  it("syncs explicit selected repo names without LOCAL_REPO_NAMES", async () => {
    const previousRepoNames = process.env.LOCAL_REPO_NAMES;
    delete process.env.LOCAL_REPO_NAMES;
    const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "tmp-local-repo-sync-"));
    const upserts: LocalRepoDocumentDraft[] = [];

    const databaseRuntime: DatabaseRuntimeModule = {
      DEFAULT_WORKSPACE_NAME: "default-workspace",
      createPrismaClient: () => ({
        async $connect() {
          return undefined;
        },
        workspace: {
          async upsert() {
            return { id: "workspace-1" };
          },
        },
        dataSource: {
          async upsert() {
            return { id: "source-1" };
          },
          async update() {
            return undefined;
          },
        },
        document: {
          async findUnique() {
            return null;
          },
          async upsert(input: unknown) {
            if (!isLocalRepoUpsertInput(input)) {
              throw new Error("unexpected upsert input");
            }

            upserts.push(input.create);
            return undefined;
          },
        },
      }),
      async disconnectPrismaClient() {
        return undefined;
      },
    };

    try {
      await fs.mkdir(path.join(rootPath, "repo-a"), { recursive: true });
      await fs.writeFile(path.join(rootPath, "repo-a", "README.md"), "# Repo A\n");

      const result = await runLocalRepoSync({
        repoRootPath: rootPath,
        selectedRepoNames: ["repo-a"],
        databaseRuntime,
      });

      expect(result).toEqual({
        inserted: 1,
        updated: 0,
        archived: 0,
        skippedUnchanged: 0,
        failed: 0,
        failures: [],
      });
      expect(upserts.map((draft) => draft.externalId)).toEqual(["repo-a:README.md"]);
    } finally {
      if (previousRepoNames === undefined) {
        delete process.env.LOCAL_REPO_NAMES;
      } else {
        process.env.LOCAL_REPO_NAMES = previousRepoNames;
      }
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("fails deterministically when selected repo names are missing", async () => {
    const previousRepoNames = process.env.LOCAL_REPO_NAMES;
    delete process.env.LOCAL_REPO_NAMES;
    const databaseRuntime: DatabaseRuntimeModule = {
      DEFAULT_WORKSPACE_NAME: "default-workspace",
      createPrismaClient: () => ({
        async $connect() {
          throw new Error("should not connect without selected repos");
        },
        workspace: {
          async upsert() {
            return { id: "workspace-1" };
          },
        },
        dataSource: {
          async upsert() {
            return { id: "source-1" };
          },
          async update() {
            return undefined;
          },
        },
        document: {
          async findUnique() {
            return null;
          },
          async upsert() {
            return undefined;
          },
        },
      }),
      async disconnectPrismaClient() {
        return undefined;
      },
    };

    try {
      await expect(
        runLocalRepoSync({
          repoRootPath: "/tmp/nonexistent-repos",
          databaseRuntime,
        }),
      ).rejects.toThrow("Missing required environment variable: LOCAL_REPO_NAMES");
    } finally {
      if (previousRepoNames === undefined) {
        delete process.env.LOCAL_REPO_NAMES;
      } else {
        process.env.LOCAL_REPO_NAMES = previousRepoNames;
      }
    }
  });
});
