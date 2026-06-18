import type { Prisma } from "@prisma/client";

import { replaceDocumentChunks, buildChunkingDocument } from "../src/document-chunks";

describe("document chunk persistence", () => {
  it("builds chunking documents with default section metadata", () => {
    const document = buildChunkingDocument("document-1", {
      sourceType: "repo_docs",
      content: "# Title\nalpha beta gamma",
      knowledgeTypes: ["architecture"],
      domainTags: ["docs"],
      metadata: {
        classifierVersion: "phase2-v1",
        matchedRules: ["path:docs"],
      },
      status: "active",
    });

    expect(document).toMatchObject({
      documentId: "document-1",
      sourceType: "repo_docs",
      content: "# Title\nalpha beta gamma",
      sectionTitle: null,
      headingPath: [],
      contentHash: null,
      knowledgeTypes: ["architecture"],
      domainTags: ["docs"],
      metadata: {
        classifierVersion: "phase2-v1",
        matchedRules: ["path:docs"],
      },
      status: "active",
      sourcePriority: 1,
      requestedMode: null,
      resolvedMode: null,
    });
  });

  it("replaces stale chunks inside a transaction before writing the new chunk set", async () => {
    const deleteMany = jest.fn().mockResolvedValue(undefined);
    const createMany = jest.fn().mockResolvedValue(undefined);
    const operations: string[] = [];
    const prisma = {
      $transaction: jest.fn(async (transactionClient: (value: Prisma.TransactionClient) => Promise<unknown>) =>
        transactionClient({
            documentChunk: {
              deleteMany: async (input: unknown) => {
                operations.push("delete");
                return deleteMany(input);
              },
              createMany: async (input: unknown) => {
                operations.push("create");
                return createMany(input);
              },
            },
        } as unknown as Prisma.TransactionClient),
      ),
    } as unknown as Parameters<typeof replaceDocumentChunks>[0];

    await replaceDocumentChunks(prisma, "workspace-1", "document-1", {
      sourceType: "repo_docs",
      content: "# Title\nalpha beta gamma",
      knowledgeTypes: ["architecture"],
      domainTags: ["docs"],
      metadata: {
        classifierVersion: "phase2-v1",
        matchedRules: ["path:docs"],
      },
      status: "active",
    });

    await replaceDocumentChunks(prisma, "workspace-1", "document-1", {
      sourceType: "repo_docs",
      content: "# Title\nalpha beta gamma delta",
      knowledgeTypes: ["architecture"],
      domainTags: ["docs"],
      metadata: {
        classifierVersion: "phase2-v1",
        matchedRules: ["path:docs"],
      },
      status: "active",
    });

    expect(operations).toEqual(["delete", "create", "delete", "create"]);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(deleteMany).toHaveBeenCalledTimes(2);
    expect(deleteMany).toHaveBeenNthCalledWith(1, {
      where: {
        workspaceId: "workspace-1",
        documentId: "document-1",
      },
    });
    expect(deleteMany).toHaveBeenNthCalledWith(2, {
      where: {
        workspaceId: "workspace-1",
        documentId: "document-1",
      },
    });
    expect(createMany).toHaveBeenCalledTimes(2);
    expect(createMany.mock.calls[0]?.[0]).toMatchObject({
      data: [
        {
          id: expect.any(String),
          workspaceId: "workspace-1",
          documentId: "document-1",
          chunkIndex: 0,
          sectionTitle: "Title",
          headingPath: ["Title"],
          sourceType: "repo_docs",
          chunkType: "markdown_section",
        },
      ],
    });
    expect(createMany.mock.calls[1]?.[0]).toMatchObject({
      data: [
        {
          id: expect.any(String),
          workspaceId: "workspace-1",
          documentId: "document-1",
          chunkIndex: 0,
          sectionTitle: "Title",
          headingPath: ["Title"],
          content: "alpha beta gamma delta",
          sourceType: "repo_docs",
          chunkType: "markdown_section",
        },
      ],
    });
  });
});
