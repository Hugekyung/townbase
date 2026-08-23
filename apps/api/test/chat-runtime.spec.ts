import {
  createDefaultDocumentRetriever,
  createFallbackEmbeddingModel,
} from "../src/chat/chat.runtime";
import { resolveRetrievalExecutionStrategy } from "../src/chat/retrieval-strategy";

describe("chat runtime defaults", () => {
  it("defaults the execution strategy to vector_only", () => {
    expect(resolveRetrievalExecutionStrategy(undefined)).toBe("vector_only");
  });

  it.each(["vector_only", "mode_aware"] as const)("accepts %s as a reserved strategy", (value) => {
    expect(resolveRetrievalExecutionStrategy(value)).toBe(value);
  });

  it("rejects an unsupported execution strategy", () => {
    expect(() => resolveRetrievalExecutionStrategy("unsupported")).toThrow(
      "RAG_RETRIEVAL_STRATEGY must be one of: vector_only, mode_aware",
    );
  });

  it("returns 1536-dimensional fallback embeddings", async () => {
    const model = createFallbackEmbeddingModel();

    await expect(model.embedText("hello")).resolves.toHaveLength(1536);
    await expect(model.embedTexts(["hello", "world"])).resolves.toEqual([
      expect.arrayContaining([expect.any(Number)]),
      expect.arrayContaining([expect.any(Number)]),
    ]);
  });

  it("returns early when the retriever has no document chunks", async () => {
    const documentChunkFindMany = jest.fn();
    const prisma = {
      documentChunk: {
        findMany: documentChunkFindMany,
      },
    } as never;
    const retrieve = createDefaultDocumentRetriever(prisma, jest.fn().mockResolvedValue([]));

    await expect(
      retrieve({
        workspaceId: "workspace-1",
        question: "What changed?",
        requestedMode: "auto",
        resolvedMode: "documentation_gap",
        executionStrategy: "vector_only",
        strategy: {
          mode: "documentation_gap",
          topK: 3,
          sourceTypes: [],
          knowledgeTypes: [],
          excludedStatuses: [],
          sourcePriorityWeight: 0,
        },
        embedding: [0.1, 0.2, 0.3],
      }),
    ).resolves.toEqual([]);
    expect(documentChunkFindMany).not.toHaveBeenCalled();
  });

  it.each(["vector_only", "mode_aware"] as const)(
    "preserves the same vector search for %s",
    async (executionStrategy) => {
      const searchChunks = jest.fn().mockResolvedValue([
        { id: "chunk-1", documentId: "document-1", score: 0.9 },
        { id: "chunk-2", documentId: "document-2", score: 0.8 },
      ]);
      const documentChunkFindMany = jest.fn().mockResolvedValue([
        {
          id: "chunk-1",
          documentId: "document-1",
          sourceType: "local_markdown",
          sectionTitle: "First",
          headingPath: ["First"],
          document: { title: "Doc 1", filePath: "docs/1.md", url: null },
        },
        {
          id: "chunk-2",
          documentId: "document-2",
          sourceType: "local_markdown",
          sectionTitle: "Second",
          headingPath: ["Second"],
          document: { title: "Doc 2", filePath: "docs/2.md", url: null },
        },
      ]);
      const retrieve = createDefaultDocumentRetriever(
        { documentChunk: { findMany: documentChunkFindMany } } as never,
        searchChunks,
      );

      const result = await retrieve({
        workspaceId: "workspace-1",
        question: "What changed?",
        requestedMode: "auto",
        resolvedMode: "documentation_gap",
        executionStrategy,
        strategy: {
          mode: "documentation_gap",
          topK: 2,
          sourceTypes: [],
          knowledgeTypes: [],
          excludedStatuses: [],
          sourcePriorityWeight: 0,
        },
        embedding: [0.1, 0.2, 0.3],
      });

      expect(searchChunks).toHaveBeenCalledWith(expect.anything(), {
        workspaceId: "workspace-1",
        embedding: [0.1, 0.2, 0.3],
        topK: 2,
        embeddingModel: "text-embedding-3-small",
        dimensions: 1536,
      });
      expect(result.map((source) => source.chunkId)).toEqual(["chunk-1", "chunk-2"]);
      expect(result.map((source) => source.rank)).toEqual([1, 2]);
    },
  );
});
