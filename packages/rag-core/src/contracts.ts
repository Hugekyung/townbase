export type ChunkType = "markdown_section" | "plain_text";

export type ChunkingMetadataValue =
  | string
  | number
  | boolean
  | null
  | readonly ChunkingMetadataValue[]
  | { readonly [key: string]: ChunkingMetadataValue };

export type ChunkingMetadata = Readonly<Record<string, ChunkingMetadataValue>>;

export type ChunkingOptions = Readonly<{
  maxTokens: number;
  overlapTokens: number;
}>;

export type ChunkingDocument = Readonly<{
  documentId: string;
  sourceType: string;
  content: string;
  sectionTitle: string | null;
  headingPath: readonly string[];
  contentHash: string | null;
  knowledgeTypes: readonly string[];
  domainTags: readonly string[];
  metadata: ChunkingMetadata;
  status: string;
  sourcePriority: number;
  requestedMode: string | null;
  resolvedMode: string | null;
}>;

export type ChunkingChunk = Readonly<{
  chunkId: string;
  documentId: string;
  chunkIndex: number;
  chunkType: ChunkType;
  content: string;
  sectionTitle: string | null;
  headingPath: readonly string[];
  tokenCount: number;
  contentHash: string;
  sourceType: string;
  knowledgeTypes: readonly string[];
  domainTags: readonly string[];
  metadata: ChunkingMetadata;
  status: string;
  sourcePriority: number;
  requestedMode: string | null;
  resolvedMode: string | null;
}>;

export interface Chunker {
  chunk(document: ChunkingDocument): readonly ChunkingChunk[];
}

export const DEFAULT_CHUNKING_OPTIONS = {
  maxTokens: 600,
  overlapTokens: 80,
} as const satisfies ChunkingOptions;
