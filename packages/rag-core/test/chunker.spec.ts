import { chunkDocument, countTokens } from "../src/chunker";

describe("chunkDocument", () => {
  it("splits markdown by heading hierarchy and preserves metadata", () => {
    // Given
    const document = {
      documentId: "doc-markdown",
      sourceType: "markdown_doc",
      content: [
        "# Intro",
        "alpha beta gamma delta epsilon",
        "## Details",
        "one two three four five six seven",
      ].join("\n"),
      sectionTitle: null,
      headingPath: [],
      contentHash: null,
      knowledgeTypes: ["onboarding"],
      domainTags: ["setup"],
      metadata: {
        pageNumber: 1,
        isPublic: true,
        tags: ["intro"],
      },
      status: "active",
      sourcePriority: 7,
      requestedMode: "auto",
      resolvedMode: "onboarding",
    } as const;

    // When
    const chunks = chunkDocument(document, {
      maxTokens: 4,
      overlapTokens: 1,
    });

    // Then
    expect(chunks).toHaveLength(4);
    expect(chunks[0]).toMatchObject({
      documentId: "doc-markdown",
      chunkIndex: 0,
      chunkType: "markdown_section",
      sectionTitle: "Intro",
      headingPath: ["Intro"],
      content: "alpha beta gamma delta",
      tokenCount: 4,
      sourceType: "markdown_doc",
      knowledgeTypes: ["onboarding"],
      domainTags: ["setup"],
      status: "active",
      sourcePriority: 7,
      requestedMode: "auto",
      resolvedMode: "onboarding",
    });
    expect(chunks[1]).toMatchObject({
      chunkIndex: 1,
      sectionTitle: "Intro",
      headingPath: ["Intro"],
      content: "delta epsilon",
      tokenCount: 2,
    });
    expect(chunks[2]).toMatchObject({
      chunkIndex: 2,
      sectionTitle: "Details",
      headingPath: ["Intro", "Details"],
      content: "one two three four",
      tokenCount: 4,
    });
    expect(chunks[3]).toMatchObject({
      chunkIndex: 3,
      sectionTitle: "Details",
      headingPath: ["Intro", "Details"],
      content: "four five six seven",
      tokenCount: 4,
    });
    const firstChunk = chunks[0];
    expect(firstChunk).toBeDefined();
    if (firstChunk === undefined) {
      throw new Error("expected the first markdown chunk to exist");
    }
    expect(countTokens(firstChunk.content)).toBe(firstChunk.tokenCount);
  });

  it("falls back to plain text token windows when there is no heading hierarchy", () => {
    // Given
    const document = {
      documentId: "doc-plain",
      sourceType: "schema",
      content: "one two three four five six seven eight nine ten",
      sectionTitle: "Schema notes",
      headingPath: ["Schema notes"],
      contentHash: null,
      knowledgeTypes: ["database"],
      domainTags: ["schema"],
      metadata: {
        pageNumber: 2,
        isPublic: false,
      },
      status: "active",
      sourcePriority: 3,
      requestedMode: "product_history",
      resolvedMode: "product_history",
    } as const;

    // When
    const chunks = chunkDocument(document, {
      maxTokens: 4,
      overlapTokens: 1,
    });

    // Then
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toMatchObject({
      chunkIndex: 0,
      chunkType: "plain_text",
      sectionTitle: "Schema notes",
      headingPath: ["Schema notes"],
      content: "one two three four",
      tokenCount: 4,
    });
    expect(chunks[1]).toMatchObject({
      chunkIndex: 1,
      content: "four five six seven",
      tokenCount: 4,
    });
    expect(chunks[2]).toMatchObject({
      chunkIndex: 2,
      content: "seven eight nine ten",
      tokenCount: 4,
    });
    expect(countTokens("one two three four five")).toBe(5);
  });

  it("propagates document metadata onto each chunk result", () => {
    // Given
    const document = {
      documentId: "doc-metadata",
      sourceType: "adr",
      content: "# Notes\nalpha beta gamma",
      sectionTitle: null,
      headingPath: [],
      contentHash: null,
      knowledgeTypes: ["architecture", "decision"],
      domainTags: ["platform", "search"],
      metadata: {
        pageNumber: 3,
        isPublic: true,
        tags: ["adr", "decision"],
      },
      status: "draft",
      sourcePriority: 11,
      requestedMode: "documentation_gap",
      resolvedMode: "documentation_gap",
    } as const;

    // When
    const [chunk] = chunkDocument(document, {
      maxTokens: 8,
      overlapTokens: 2,
    });

    // Then
    expect(chunk).toMatchObject({
      documentId: "doc-metadata",
      sourceType: "adr",
      knowledgeTypes: ["architecture", "decision"],
      domainTags: ["platform", "search"],
      status: "draft",
      sourcePriority: 11,
      requestedMode: "documentation_gap",
      resolvedMode: "documentation_gap",
      sectionTitle: "Notes",
      headingPath: ["Notes"],
    });
  });

  it("treats malformed markdown without headings as plain text and skips empty content", () => {
    // Given
    const malformedDocument = {
      documentId: "doc-malformed",
      sourceType: "readme",
      content: "```ts\nconst value = 1\n",
      sectionTitle: "Readme",
      headingPath: ["Readme"],
      contentHash: null,
      knowledgeTypes: [],
      domainTags: [],
      metadata: {
        pageNumber: 4,
        isPublic: true,
      },
      status: "active",
      sourcePriority: 1,
      requestedMode: null,
      resolvedMode: null,
    } as const;

    const emptyDocument = {
      ...malformedDocument,
      documentId: "doc-empty",
      content: "   \n\t  ",
    } as const;

    // When
    const malformedChunks = chunkDocument(malformedDocument, {
      maxTokens: 4,
      overlapTokens: 1,
    });
    const emptyChunks = chunkDocument(emptyDocument);

    // Then
    expect(malformedChunks).toHaveLength(2);
    expect(malformedChunks[0]).toMatchObject({
      chunkType: "plain_text",
      chunkIndex: 0,
      content: "```ts const value =",
      headingPath: ["Readme"],
      sectionTitle: "Readme",
    });
    expect(malformedChunks[1]).toMatchObject({
      chunkType: "plain_text",
      chunkIndex: 1,
      content: "= 1",
      headingPath: ["Readme"],
      sectionTitle: "Readme",
    });
    expect(emptyChunks).toEqual([]);
  });

  it("treats fenced code that only resembles markdown as plain text fallback", () => {
    // Given
    const document = {
      documentId: "doc-fenced",
      sourceType: "readme",
      content: [
        "```md",
        "# Shadow Heading",
        "alpha beta gamma delta epsilon",
        "```",
      ].join("\n"),
      sectionTitle: "Readme",
      headingPath: ["Readme"],
      contentHash: null,
      knowledgeTypes: [],
      domainTags: [],
      metadata: {
        pageNumber: 6,
        isPublic: true,
      },
      status: "active",
      sourcePriority: 1,
      requestedMode: null,
      resolvedMode: null,
    } as const;

    // When
    const chunks = chunkDocument(document, {
      maxTokens: 4,
      overlapTokens: 1,
    });

    // Then
    expect(chunks).toHaveLength(3);
    expect(chunks.every(({ chunkType }) => chunkType === "plain_text")).toBe(true);
    expect(chunks[0]).toMatchObject({
      chunkIndex: 0,
      content: "```md # Shadow Heading",
      headingPath: ["Readme"],
      sectionTitle: "Readme",
    });
    expect(chunks[2]).toMatchObject({
      chunkIndex: 2,
      content: "gamma delta epsilon ```",
      headingPath: ["Readme"],
      sectionTitle: "Readme",
    });
  });

  it("returns no chunks for empty content", () => {
    // Given
    const document = {
      documentId: "doc-empty",
      sourceType: "markdown_doc",
      content: "",
      sectionTitle: null,
      headingPath: [],
      contentHash: null,
      knowledgeTypes: [],
      domainTags: [],
      metadata: {
        pageNumber: 5,
        isPublic: false,
      },
      status: "active",
      sourcePriority: 1,
      requestedMode: null,
      resolvedMode: null,
    } as const;

    // When
    const chunks = chunkDocument(document);

    // Then
    expect(chunks).toEqual([]);
  });
});
