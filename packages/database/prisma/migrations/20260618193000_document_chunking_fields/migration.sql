ALTER TABLE "DocumentChunk" ADD COLUMN "chunkIndex" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DocumentChunk" ADD COLUMN "sectionTitle" TEXT;
ALTER TABLE "DocumentChunk" ADD COLUMN "headingPath" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "DocumentChunk" ADD COLUMN "contentHash" TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX "DocumentChunk_workspaceId_documentId_chunkIndex_key"
ON "DocumentChunk"("workspaceId", "documentId", "chunkIndex");
