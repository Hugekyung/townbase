import { buildDocumentChunkEmbeddingUpsertQuery, buildDocumentChunkVectorSearchQuery, listIndexedDocumentChunkIds, persistDocumentChunkEmbedding, readDocumentChunkEmbeddingDimensions, searchDocumentChunksByEmbedding, toPgVectorLiteral } from "../src/embedding";
import type { DocumentChunkEmbeddingQueryClient } from "../src/embedding";

describe("database embedding helpers", () => {
  it("serializes pgvector literals and rejects empty embeddings", () => {
    expect(toPgVectorLiteral([0.1, 0.2, 0.3])).toBe("[0.1,0.2,0.3]");
    expect(() => toPgVectorLiteral([])).toThrow("embedding must not be empty");
  });

  it("builds an embedding upsert query with workspace and chunk constraints", async () => {
    const queries: Array<unknown> = [];
    const client: DocumentChunkEmbeddingQueryClient = {
      async $queryRaw<T>() {
        return [] as T;
      },
      async $executeRaw(query) {
        queries.push(query);
        return 1;
      },
    };

    await expect(
      persistDocumentChunkEmbedding(client, {
        workspaceId: "workspace-1",
        chunkId: "chunk-1",
        embedding: [0.1, 0.2, 0.3],
        embeddingModel: "test-model",
      }),
    ).resolves.toBe(1);

    const query = buildDocumentChunkEmbeddingUpsertQuery({
      workspaceId: "workspace-1",
      chunkId: "chunk-1",
      embedding: [0.1, 0.2, 0.3],
      embeddingModel: "test-model",
    });

    expect(query.sql).toContain('UPDATE "DocumentChunk"');
    expect(query.values).toContain("workspace-1");
    expect(query.values).toContain("chunk-1");
    expect(query.values).toContain("[0.1,0.2,0.3]");
    expect(queries).toHaveLength(1);
  });

  it("builds a vector search query that scopes by workspace and threshold", async () => {
    const rows = [
      {
        id: "chunk-1",
        documentId: "document-1",
        score: 0.91,
      },
    ];
    const queries: Array<unknown> = [];
    const client: DocumentChunkEmbeddingQueryClient = {
      async $queryRaw<T>() {
        return rows as T;
      },
      async $executeRaw() {
        return 1;
      },
    };

    await expect(
      searchDocumentChunksByEmbedding(client, {
        workspaceId: "workspace-1",
        embedding: [0.1, 0.2, 0.3],
        topK: 5,
        scoreThreshold: 0.8,
      }),
    ).resolves.toEqual(rows);

    const query = buildDocumentChunkVectorSearchQuery({
      workspaceId: "workspace-1",
      embedding: [0.1, 0.2, 0.3],
      topK: 5,
      scoreThreshold: 0.8,
    });

    queries.push(query);
    expect(query.sql).toContain('FROM "DocumentChunk"');
    expect(query.sql).toContain('"workspaceId" =');
    expect(query.sql).toContain('>=');
    expect(query.values).toContain("workspace-1");
    expect(query.values).toContain(5);
    expect(query.values).toContain(0.8);
    expect(queries).toHaveLength(1);
  });

  it("lists only chunks that already have an embedding", async () => {
    const client: DocumentChunkEmbeddingQueryClient = {
      async $queryRaw<T>() {
        return [{ id: "chunk-1" }] as T;
      },
      async $executeRaw() {
        return 1;
      },
    };

    await expect(
      listIndexedDocumentChunkIds(client, "workspace-1", ["chunk-1", "chunk-2"], "test-model", 3),
    ).resolves.toEqual(["chunk-1"]);
  });

  it("reads persisted vector dimensions for selected chunks", async () => {
    const client: DocumentChunkEmbeddingQueryClient = {
      async $queryRaw<T>() {
        return [{ id: "chunk-1", dimensions: 1536 }] as T;
      },
      async $executeRaw() {
        return 1;
      },
    };

    await expect(readDocumentChunkEmbeddingDimensions(client, "workspace-1", ["chunk-1"])).resolves.toEqual([
      { id: "chunk-1", dimensions: 1536 },
    ]);
  });
});
