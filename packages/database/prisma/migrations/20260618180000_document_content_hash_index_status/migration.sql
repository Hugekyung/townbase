ALTER TABLE "Document" ADD COLUMN "contentHash" TEXT;
ALTER TABLE "Document" ADD COLUMN "indexStatus" TEXT NOT NULL DEFAULT 'pending';
