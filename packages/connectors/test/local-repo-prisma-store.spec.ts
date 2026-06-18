import type { Prisma } from "@prisma/client";

import { mapLocalRepoFileToDocumentDraft } from "../src/local-repo/mapping";
import { createPrismaLocalRepoSyncStore } from "../src/local-repo/prisma-store";

describe("createPrismaLocalRepoSyncStore", () => {
  it("persists repo document upserts and chunk replacement within a single transaction", async () => {
    const callOrder: string[] = [];
    const upsert = jest.fn(async () => {
      callOrder.push("document.upsert");
      return { id: "document-1" };
    });
    const deleteMany = jest.fn(async () => {
      callOrder.push("documentChunk.deleteMany");
    });
    const createMany = jest.fn(async () => {
      callOrder.push("documentChunk.createMany");
    });
    const transaction = jest.fn(async (transactionClient: (value: Prisma.TransactionClient) => Promise<unknown>) =>
      transactionClient({
        document: {
          upsert,
        },
        documentChunk: {
          deleteMany,
          createMany,
        },
      } as unknown as Prisma.TransactionClient),
    );

    const prisma = {
      $transaction: transaction,
      document: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
      dataSource: {
        update: jest.fn(),
      },
    } as unknown as Parameters<typeof createPrismaLocalRepoSyncStore>[0];

    const store = createPrismaLocalRepoSyncStore(prisma, {
      workspaceId: "workspace-1",
      dataSourceId: "source-1",
    });
    const draft = mapLocalRepoFileToDocumentDraft({
      workspaceId: "workspace-1",
      dataSourceId: "source-1",
      file: {
        repoName: "repo-a",
        filePath: "README.md",
        content: "# Repo A\nalpha beta gamma",
        createdAt: new Date("2024-01-01T00:00:00.000Z"),
        modifiedAt: new Date("2024-01-02T00:00:00.000Z"),
      },
    });

    await store.upsertDocument(draft);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual([
      "document.upsert",
      "documentChunk.deleteMany",
      "documentChunk.createMany",
    ]);
    expect(deleteMany).toHaveBeenCalledTimes(1);
    expect(createMany).toHaveBeenCalledTimes(1);
  });
});
