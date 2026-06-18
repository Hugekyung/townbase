import type { Prisma } from "@prisma/client";

import { embedQuestionText, indexDocumentChunks, searchSimilarChunksForQuestion } from "../src/embedding";
import type { EmbeddingModel } from "@townbase/rag-core";

describe("embedding service", () => {
  it("embeds a question and scopes vector search by workspace", async () => {
    const queryCalls: Prisma.Sql[] = [];
    const model: EmbeddingModel = {
      model: "test-embedding-model",
      async embedText(text: string) {
        expect(text).toBe("How do I update the schema?");
        return [0.1, 0.2, 0.3];
      },
      async embedTexts(texts: readonly string[]) {
        expect(texts).toEqual(["How do I update the schema?"]);
        return [[0.1, 0.2, 0.3]];
      },
    };
    const prisma = {
      async $queryRaw(query: Prisma.Sql) {
        queryCalls.push(query);
        return [
          {
            id: "chunk-1",
            documentId: "document-1",
            score: 0.95,
          },
        ];
      },
      async $executeRaw() {
        return 1;
      },
      async $transaction<T>(
        callback: (transactionClient: { readonly $executeRaw: (query: Prisma.Sql) => Promise<number> }) => Promise<T>,
      ): Promise<T> {
        return callback({
          async $executeRaw() {
            return 1;
          },
        });
      },
      document: {
        async update() {
          return undefined;
        },
      },
    } as unknown as Parameters<typeof searchSimilarChunksForQuestion>[0];

    const embedding = await embedQuestionText(model, "How do I update the schema?");
    expect(embedding).toEqual([0.1, 0.2, 0.3]);

    const rows = await searchSimilarChunksForQuestion(prisma, model, {
      workspaceId: "workspace-1",
      question: "How do I update the schema?",
      topK: 4,
      scoreThreshold: 0.8,
    });

    expect(rows).toEqual([
      {
        id: "chunk-1",
        documentId: "document-1",
        score: 0.95,
      },
    ]);
    expect(queryCalls).toHaveLength(1);
    expect(queryCalls[0]?.values).toContain("workspace-1");
    expect(queryCalls[0]?.values).toContain(4);
    expect(queryCalls[0]?.values).toContain(0.8);
  });

  it("stores chunk embeddings and marks the document indexed", async () => {
    const executeRaw = jest.fn(async () => 1);
    const documentUpdate = jest.fn(async () => undefined);
    const model: EmbeddingModel = {
      model: "test-embedding-model",
      async embedText(text: string) {
        expect(text).toBe("alpha beta");
        return [0.11, 0.12, 0.13];
      },
      async embedTexts(texts: readonly string[]) {
        expect(texts).toEqual(["alpha beta", "gamma delta"]);
        return [
          [0.11, 0.12, 0.13],
          [0.21, 0.22, 0.23],
        ];
      },
    };
    const prisma = {
      async $queryRaw() {
        return [];
      },
      async $executeRaw() {
        return 1;
      },
      async $transaction<T>(
        callback: (transactionClient: { readonly $executeRaw: (query: Prisma.Sql) => Promise<number> }) => Promise<T>,
      ): Promise<T> {
        return callback({
          $executeRaw: executeRaw,
        });
      },
      document: {
        update: documentUpdate,
      },
    } as unknown as Parameters<typeof indexDocumentChunks>[0];

    const result = await indexDocumentChunks(
      prisma,
      model,
      "workspace-1",
      "document-1",
      [
        {
          chunkId: "chunk-1",
          documentId: "document-1",
          content: "alpha beta",
        },
        {
          chunkId: "chunk-2",
          documentId: "document-1",
          content: "gamma delta",
        },
      ],
    );

    expect(result).toEqual({
      kind: "indexed",
      documentId: "document-1",
      chunkCount: 2,
    });
    expect(executeRaw).toHaveBeenCalledTimes(2);
    expect(documentUpdate).toHaveBeenCalledWith({
      where: {
        workspaceId_id: {
          workspaceId: "workspace-1",
          id: "document-1",
        },
      },
      data: {
        indexStatus: "indexed",
      },
    });
  });

  it("marks the document failed when embedding generation fails", async () => {
    const documentUpdate = jest.fn(async () => undefined);
    const model: EmbeddingModel = {
      model: "test-embedding-model",
      async embedText() {
        return [0.11, 0.12, 0.13];
      },
      async embedTexts() {
        throw new Error("embedding service unavailable");
      },
    };
    const prisma = {
      async $queryRaw() {
        return [];
      },
      async $executeRaw() {
        return 1;
      },
      async $transaction<T>(
        callback: (transactionClient: { readonly $executeRaw: (query: Prisma.Sql) => Promise<number> }) => Promise<T>,
      ): Promise<T> {
        return callback({
          async $executeRaw() {
            return 1;
          },
        });
      },
      document: {
        update: documentUpdate,
      },
    } as unknown as Parameters<typeof indexDocumentChunks>[0];

    const result = await indexDocumentChunks(
      prisma,
      model,
      "workspace-1",
      "document-1",
      [
        {
          chunkId: "chunk-1",
          documentId: "document-1",
          content: "alpha beta",
        },
      ],
    );

    expect(result).toEqual({
      kind: "failed",
      documentId: "document-1",
      reason: "embedding service unavailable",
    });
    expect(documentUpdate).toHaveBeenCalledWith({
      where: {
        workspaceId_id: {
          workspaceId: "workspace-1",
          id: "document-1",
        },
      },
      data: {
        indexStatus: "failed",
      },
    });
  });
});
