export { chunkDocument, countTokens } from "./chunker";
export type {
  ChunkType,
  ChunkingChunk,
  ChunkingDocument,
  ChunkingMetadata,
  ChunkingMetadataValue,
  ChunkingOptions,
} from "./contracts";
export type { Chunker } from "./contracts";

export const RAG_CORE_PACKAGE_INFO = {
  name: "@townbase/rag-core",
  version: "0.1.0",
} as const;
