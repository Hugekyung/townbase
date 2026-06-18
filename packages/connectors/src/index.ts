export type { NotionConnectorEnv, LocalRepoConnectorEnv } from "./env";
export { loadNotionConnectorEnv } from "./env";
export { loadLocalRepoConnectorEnv } from "./env";
export {
  createEmbeddingModel,
  loadEmbeddingModelEnv,
  type EmbeddingModelEnv,
} from "./embedding-model";
export {
  embedDocumentChunks,
  embedQuestionText,
  indexDocumentChunks,
  searchSimilarChunksForQuestion,
  type ChunkEmbeddingIndexResult,
  type ChunkEmbeddingSearchInput,
  type EmbeddableChunk,
  type IndexedChunkEmbedding,
} from "./embedding";
export {
  buildChunkMetadata,
  classifyNotionPage,
  classifyRepositoryPath,
  mapNotionPageToDocumentDraft,
  type ClassificationResult,
  type DocumentStatus,
  type KnowledgeType,
  type NotionPageDraft,
  type SourceType,
} from "./classification";
export {
  collectSelectedLocalRepoFiles,
  createPrismaLocalRepoSyncStore,
  isExcludedLocalRepoPath,
  isIncludedLocalRepoPath,
  mapLocalRepoFileToDocumentDraft,
  runLocalRepoSync,
  syncLocalRepoFiles,
  type LocalRepoDocumentDraft,
  type LocalRepoFileSnapshot,
  type LocalRepoSyncFailure,
  type LocalRepoSyncInput,
  type LocalRepoSyncStore,
  type LocalRepoSyncSummary,
} from "./local-repo";
export {
  type NotionPageClassification,
  syncNotionPages,
  type NotionSyncFailure,
  type NotionSyncInput,
  type NotionSyncLogger,
  type NotionSyncStore,
  type NotionSyncSummary,
} from "./notion";
export type {
  NotionBlockChildrenResponse,
  NotionBlockRecord,
  NotionClientLike,
  NotionPageRecord,
  NotionPageSnapshot,
} from "./notion";
export { loadNotionPageSnapshot } from "./notion";
export { runNotionSync } from "./sync";
export {
  normalizeLocalRepoSyncSummary,
  normalizeNotionSyncSummary,
  type ConnectorIndexBoundary,
  type ConnectorSyncFailure,
  type ConnectorSyncSummary,
} from "./sync-contract";
