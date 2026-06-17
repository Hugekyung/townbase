import { createHash } from "node:crypto";

import {
  DEFAULT_CHUNKING_OPTIONS,
  type ChunkType,
  type ChunkingChunk,
  type ChunkingDocument,
  type ChunkingOptions,
} from "./contracts";
import { hashText } from "./hash";
import { parseMarkdownSections } from "./markdown";
import { countTokens, joinTokens, tokenize } from "./tokenizer";

const buildChunkId = (documentId: string, chunkIndex: number, contentHash: string): string =>
  createHash("sha256").update(`${documentId}:${chunkIndex}:${contentHash}`, "utf8").digest("hex");

const resolveOptions = (options?: Partial<ChunkingOptions>): ChunkingOptions => {
  const maxTokens = options?.maxTokens ?? DEFAULT_CHUNKING_OPTIONS.maxTokens;
  const overlapTokens = options?.overlapTokens ?? DEFAULT_CHUNKING_OPTIONS.overlapTokens;
  if (maxTokens <= 0) {
    throw new RangeError("maxTokens must be positive");
  }
  if (overlapTokens < 0) {
    throw new RangeError("overlapTokens must not be negative");
  }
  return {
    maxTokens,
    overlapTokens: Math.min(overlapTokens, maxTokens - 1),
  };
};

const splitTokens = (
  tokens: readonly string[],
  options: ChunkingOptions,
): readonly string[][] => {
  if (tokens.length === 0) {
    return [];
  }

  if (tokens.length <= options.maxTokens) {
    return [Array.from(tokens)];
  }

  const windows: string[][] = [];
  const step = Math.max(options.maxTokens - options.overlapTokens, 1);

  for (let start = 0; start < tokens.length; start += step) {
    const end = Math.min(start + options.maxTokens, tokens.length);
    windows.push(tokens.slice(start, end));
    if (end === tokens.length) {
      break;
    }
  }

  return windows;
};

const buildChunk = (
  document: ChunkingDocument,
  chunkIndex: number,
  chunkType: ChunkType,
  headingPath: readonly string[],
  sectionTitle: string | null,
  content: string,
): ChunkingChunk => {
  const contentHash = hashText(content);
  return {
    chunkId: buildChunkId(document.documentId, chunkIndex, contentHash),
    documentId: document.documentId,
    chunkIndex,
    chunkType,
    content,
    sectionTitle,
    headingPath: [...headingPath],
    tokenCount: countTokens(content),
    contentHash,
    sourceType: document.sourceType,
    knowledgeTypes: [...document.knowledgeTypes],
    domainTags: [...document.domainTags],
    metadata: document.metadata,
    status: document.status,
    sourcePriority: document.sourcePriority,
    requestedMode: document.requestedMode,
    resolvedMode: document.resolvedMode,
  };
};

const chunkSection = (
  document: ChunkingDocument,
  chunkType: ChunkType,
  headingPath: readonly string[],
  sectionTitle: string | null,
  content: string,
  options: ChunkingOptions,
  startIndex: number,
): readonly ChunkingChunk[] => {
  const tokens = tokenize(content);
  const windows = splitTokens(tokens, options);
  return windows.map((window, offset) =>
    buildChunk(
      document,
      startIndex + offset,
      chunkType,
      headingPath,
      sectionTitle,
      joinTokens(window),
    ),
  );
};

const chunkMarkdownDocument = (document: ChunkingDocument, options: ChunkingOptions): readonly ChunkingChunk[] => {
  const sections = parseMarkdownSections(document.content);
  if (sections.length === 0) {
    return [];
  }

  const chunks: ChunkingChunk[] = [];
  let chunkIndex = 0;
  for (const section of sections) {
    const sectionChunks = chunkSection(
      document,
      "markdown_section",
      section.headingPath,
      section.sectionTitle,
      section.content,
      options,
      chunkIndex,
    );
    chunks.push(...sectionChunks);
    chunkIndex += sectionChunks.length;
  }

  return chunks;
};

const chunkPlainTextDocument = (document: ChunkingDocument, options: ChunkingOptions): readonly ChunkingChunk[] => {
  const content = document.content.trim();
  if (content.length === 0) {
    return [];
  }

  return chunkSection(
    document,
    "plain_text",
    document.headingPath,
    document.sectionTitle,
    content,
    options,
    0,
  );
};

export const chunkDocument = (
  document: ChunkingDocument,
  options?: Partial<ChunkingOptions>,
): readonly ChunkingChunk[] => {
  const resolvedOptions = resolveOptions(options);
  const markdownChunks = chunkMarkdownDocument(document, resolvedOptions);
  return markdownChunks.length > 0 ? markdownChunks : chunkPlainTextDocument(document, resolvedOptions);
};

export { countTokens } from "./tokenizer";
