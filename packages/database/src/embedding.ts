import { Prisma } from "@prisma/client";

export type VectorSearchRow = Readonly<{
  id: string;
  documentId: string;
  score: number;
}>;

export type DocumentChunkVectorSearchInput = Readonly<{
  workspaceId: string;
  embedding: readonly number[];
  embeddingModel: string;
  dimensions: number;
  topK: number;
  scoreThreshold?: number;
}>;

export type DocumentChunkEmbeddingUpsertInput = Readonly<{
  workspaceId: string;
  chunkId: string;
  embedding: readonly number[];
  embeddingModel: string;
}>;

export type DocumentChunkEmbeddingExecuteClient = Readonly<{
  $executeRaw: (query: Prisma.Sql) => Promise<number>;
}>;

export type DocumentChunkEmbeddingQueryClient = DocumentChunkEmbeddingExecuteClient &
  Readonly<{
    $queryRaw: <T>(query: Prisma.Sql) => Promise<T>;
  }>;

export const listIndexedDocumentChunkIds = async (
  client: Readonly<{ $queryRaw: <T>(query: Prisma.Sql) => Promise<T> }>,
  workspaceId: string,
  chunkIds: readonly string[],
  embeddingModel: string,
  dimensions: number,
): Promise<readonly string[]> => {
  if (chunkIds.length === 0) {
    return [];
  }

  const rows = await client.$queryRaw<readonly { readonly id: string }[]>(Prisma.sql`
    SELECT "id"
    FROM "DocumentChunk"
    WHERE "workspaceId" = ${workspaceId}
      AND "id" IN (${Prisma.join(chunkIds)})
      AND "embedding" IS NOT NULL
      AND "embeddingModel" = ${embeddingModel}
      AND vector_dims("embedding") = ${dimensions}
  `);

  return rows.map(({ id }) => id);
};

export const readDocumentChunkEmbeddingDimensions = async (
  client: Readonly<{ $queryRaw: <T>(query: Prisma.Sql) => Promise<T> }>,
  workspaceId: string,
  chunkIds: readonly string[],
): Promise<readonly { readonly id: string; readonly dimensions: number | null }[]> => {
  if (chunkIds.length === 0) {
    return [];
  }

  return client.$queryRaw(Prisma.sql`
    SELECT "id", vector_dims("embedding") AS "dimensions"
    FROM "DocumentChunk"
    WHERE "workspaceId" = ${workspaceId}
      AND "id" IN (${Prisma.join(chunkIds)})
  `);
};

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
      AND "embeddingModel" = ${input.embeddingModel}
      AND vector_dims("embedding") = ${input.dimensions}
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
        "embeddingModel" = ${input.embeddingModel},
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
