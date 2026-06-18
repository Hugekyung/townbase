import {
  createDefaultDocumentRetriever,
  createFallbackEmbeddingModel,
} from "../src/chat/chat.runtime";

describe("chat runtime defaults", () => {
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
});
