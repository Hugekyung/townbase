import type { Prisma } from "@prisma/client";

import { mapNotionPageToDocumentDraft } from "../src/notion/mapping";
import { createPrismaNotionSyncStore } from "../src/notion/prisma-store";

describe("createPrismaNotionSyncStore", () => {
  it("persists document upserts and chunk replacement within a single transaction", async () => {
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
    } as unknown as Parameters<typeof createPrismaNotionSyncStore>[0];

    const store = createPrismaNotionSyncStore(prisma, {
      workspaceId: "workspace-1",
      dataSourceId: "source-1",
    });
    const draft = mapNotionPageToDocumentDraft({
      workspaceId: "workspace-1",
      dataSourceId: "source-1",
      page: {
        id: "page-1",
        title: "Getting Started",
        url: "https://notion.so/page-1",
        lastEditedTime: "2024-01-01T00:00:00.000Z",
      },
      content: "# Intro\nalpha beta gamma",
      pathSegments: ["Engineering", "Onboarding"],
      archived: undefined,
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
