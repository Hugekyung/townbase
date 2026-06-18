ALTER TABLE "DocumentChunk" ADD COLUMN "chunkIndex" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DocumentChunk" ADD COLUMN "sectionTitle" TEXT;
ALTER TABLE "DocumentChunk" ADD COLUMN "headingPath" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "DocumentChunk" ADD COLUMN "contentHash" TEXT NOT NULL DEFAULT '';

WITH chunk_ranks AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "workspaceId", "documentId"
      ORDER BY "createdAt", "id"
    ) - 1 AS "chunkIndex"
  FROM "DocumentChunk"
)
UPDATE "DocumentChunk"
SET "chunkIndex" = chunk_ranks."chunkIndex"
FROM chunk_ranks
WHERE "DocumentChunk"."id" = chunk_ranks."id";

ALTER TABLE "DocumentChunk" ALTER COLUMN "chunkIndex" DROP DEFAULT;
ALTER TABLE "DocumentChunk" ALTER COLUMN "headingPath" DROP DEFAULT;
ALTER TABLE "DocumentChunk" ALTER COLUMN "contentHash" DROP DEFAULT;

CREATE UNIQUE INDEX "DocumentChunk_workspaceId_documentId_chunkIndex_key"
ON "DocumentChunk"("workspaceId", "documentId", "chunkIndex");
