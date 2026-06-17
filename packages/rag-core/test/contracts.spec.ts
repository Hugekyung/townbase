import { chunkDocument } from "../src/chunker";
import type { ChunkingChunk, ChunkingDocument } from "../src/contracts";

describe("chunking contract metadata", () => {
  it("accepts JSON-like metadata values and preserves them on chunks", () => {
    const document = {
      documentId: "doc-contract",
      sourceType: "readme",
      content: "# Title\nalpha beta gamma",
      sectionTitle: null,
      headingPath: [],
      contentHash: null,
      knowledgeTypes: ["documentation"],
      domainTags: ["core", "search"],
      metadata: {
        pageNumber: 12,
        isPublic: true,
        tags: ["rag", "docs"],
        nested: {
          source: "github",
          revision: 3,
        },
      },
      status: "active",
      sourcePriority: 5,
      requestedMode: "documentation_gap",
      resolvedMode: "documentation_gap",
    } satisfies ChunkingDocument;

    const chunks = chunkDocument(document, {
      maxTokens: 8,
      overlapTokens: 2,
    });

    expect(chunks).toHaveLength(1);
    const chunk = chunks[0];
    expect(chunk).toBeDefined();
    if (chunk === undefined) {
      throw new Error("expected a chunk to be produced");
    }

    const typedChunk: ChunkingChunk = chunk;
    expect(typedChunk.metadata).toEqual(document.metadata);
    expect(typedChunk.metadata.pageNumber).toBe(12);
    expect(typedChunk.metadata.isPublic).toBe(true);
    expect(typedChunk.metadata.tags).toEqual(["rag", "docs"]);
    expect(typedChunk.metadata.nested).toEqual({
      source: "github",
      revision: 3,
    });
  });
});
