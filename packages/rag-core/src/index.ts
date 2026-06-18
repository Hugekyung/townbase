export { chunkDocument, countTokens } from "./chunker";
export {
  createOpenAIEmbeddingModel,
  DEFAULT_OPENAI_EMBEDDING_MODEL_NAME,
  type EmbeddingModel,
  type EmbeddingModelConfig,
  type EmbeddingVector,
} from "./embedding";
export {
  RETRIEVAL_MODES,
  buildRetrievalStrategy,
  classifyAutoRetrievalMode,
  rankRetrievalCandidates,
  resolveRetrievalMode,
  scoreRetrievalCandidate,
  selectRetrievalCandidates,
  type RankedRetrievalCandidate,
  type ResolvedRetrievalMode,
  type RetrievalCandidate,
  type RetrievalMode,
  type RetrievalSelection,
  type RetrievalStrategy,
  type RetrievalStrategyContext,
} from "./retrieval-mode";
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
