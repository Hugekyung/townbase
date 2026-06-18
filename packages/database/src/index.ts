export { DEFAULT_DATABASE_URL, DEFAULT_WORKSPACE_NAME } from "./runtime";
export { createPrismaClient, disconnectPrismaClient } from "./prisma-client";
export {
  buildDocumentChunkEmbeddingUpsertQuery,
  buildDocumentChunkVectorSearchQuery,
  persistDocumentChunkEmbedding,
  searchDocumentChunksByEmbedding,
  toPgVectorLiteral,
  type DocumentChunkEmbeddingExecuteClient,
  type DocumentChunkEmbeddingQueryClient,
  type DocumentChunkEmbeddingUpsertInput,
  type DocumentChunkVectorSearchInput,
  type VectorSearchRow,
} from "./embedding";
export {
  persistQuestionRetrievalSelection,
  type PersistQuestionRetrievalSelectionInput,
  type PersistQuestionRetrievalSelectionSourceInput,
  type RetrievalMode,
} from "./retrieval-mode";
export {
  buildKnowledgeGapWhere,
  listKnowledgeGaps,
  updateKnowledgeGapStatus,
  type KnowledgeGapListFilter,
  type KnowledgeGapListRow,
  type KnowledgeGapQueryClient,
  type KnowledgeGapStatusUpdateInput,
} from "./knowledge-gap";
export type { PrismaClient } from "@prisma/client";
