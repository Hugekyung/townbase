export type ChunkingDocument = {
  readonly documentId: string;
  readonly sourceType: string;
  readonly content: string;
  readonly sectionTitle: string | null;
  readonly headingPath: readonly string[];
  readonly metadata: Readonly<Record<string, string>>;
};

export type ChunkingChunk = {
  readonly chunkId: string;
  readonly documentId: string;
  readonly chunkIndex: number;
  readonly chunkType: string;
  readonly content: string;
  readonly sectionTitle: string | null;
  readonly headingPath: readonly string[];
  readonly tokenCount: number;
  readonly contentHash: string;
  readonly metadata: Readonly<Record<string, string>>;
};

export interface Chunker {
  chunk(document: ChunkingDocument): readonly ChunkingChunk[];
}
