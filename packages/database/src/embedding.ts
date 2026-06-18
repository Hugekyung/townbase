import { Prisma } from "@prisma/client";

export type VectorSearchRow = Readonly<{
  id: string;
  documentId: string;
  score: number;
}>;

export type DocumentChunkVectorSearchInput = Readonly<{
  workspaceId: string;
  embedding: readonly number[];
  topK: number;
  scoreThreshold?: number;
}>;

export type DocumentChunkEmbeddingUpsertInput = Readonly<{
  workspaceId: string;
  chunkId: string;
  embedding: readonly number[];
}>;

export type DocumentChunkEmbeddingExecuteClient = Readonly<{
  $executeRaw: (query: Prisma.Sql) => Promise<number>;
}>;

export type DocumentChunkEmbeddingQueryClient = DocumentChunkEmbeddingExecuteClient &
  Readonly<{
    $queryRaw: <T>(query: Prisma.Sql) => Promise<T>;
  }>;

const assertFiniteNumber = (value: number, label: string): number => {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }

  return value;
};

export const toPgVectorLiteral = (embedding: readonly number[]): string => {
  if (embedding.length === 0) {
    throw new Error("embedding must not be empty");
  }

  return `[${embedding
    .map((value, index) => assertFiniteNumber(value, `embedding[${index}]`))
    .join(",")}]`;
};

export const buildDocumentChunkVectorSearchQuery = (
  input: DocumentChunkVectorSearchInput,
): Prisma.Sql => {
  const embeddingLiteral = toPgVectorLiteral(input.embedding);
  const thresholdClause =
    input.scoreThreshold === undefined
      ? Prisma.empty
      : Prisma.sql`AND 1 - ("embedding" <=> ${embeddingLiteral}::vector) >= ${input.scoreThreshold}`;

  return Prisma.sql`
    SELECT
      "id",
      "documentId",
      1 - ("embedding" <=> ${embeddingLiteral}::vector) AS score
    FROM "DocumentChunk"
    WHERE "workspaceId" = ${input.workspaceId}
      AND "embedding" IS NOT NULL
      ${thresholdClause}
    ORDER BY "embedding" <=> ${embeddingLiteral}::vector
    LIMIT ${input.topK}
  `;
};

export const buildDocumentChunkEmbeddingUpsertQuery = (
  input: DocumentChunkEmbeddingUpsertInput,
): Prisma.Sql => {
  const embeddingLiteral = toPgVectorLiteral(input.embedding);

  return Prisma.sql`
    UPDATE "DocumentChunk"
    SET "embedding" = ${embeddingLiteral}::vector,
        "updatedAt" = NOW()
    WHERE "workspaceId" = ${input.workspaceId}
      AND "id" = ${input.chunkId}
  `;
};

export const persistDocumentChunkEmbedding = async (
  client: DocumentChunkEmbeddingExecuteClient,
  input: DocumentChunkEmbeddingUpsertInput,
): Promise<number> => client.$executeRaw(buildDocumentChunkEmbeddingUpsertQuery(input));

export const searchDocumentChunksByEmbedding = async (
  client: DocumentChunkEmbeddingQueryClient,
  input: DocumentChunkVectorSearchInput,
): Promise<readonly VectorSearchRow[]> =>
  client.$queryRaw<readonly VectorSearchRow[]>(buildDocumentChunkVectorSearchQuery(input));
