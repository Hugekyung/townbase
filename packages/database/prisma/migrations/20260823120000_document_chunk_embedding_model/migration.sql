ALTER TABLE "DocumentChunk" ADD COLUMN "embeddingModel" TEXT;

UPDATE "DocumentChunk"
SET "embeddingModel" = 'text-embedding-3-small'
WHERE "embedding" IS NOT NULL;
