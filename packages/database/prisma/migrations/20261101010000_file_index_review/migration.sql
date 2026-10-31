-- Existing timestamps cannot reconstruct ambiguous history. For equal completion
-- times place failures last (fail closed), then start time/UUID for stable ordering.
ALTER TABLE "FileExtractionRun" ADD COLUMN ordinal INTEGER;
WITH ranked AS (
 SELECT id, row_number() OVER (PARTITION BY "installationId","versionId"
 ORDER BY "completedAt", CASE WHEN status='failed' THEN 1 ELSE 0 END, "startedAt",id)::integer AS ordinal
 FROM "FileExtractionRun"
) UPDATE "FileExtractionRun" r SET ordinal=ranked.ordinal FROM ranked WHERE r.id=ranked.id;
ALTER TABLE "FileExtractionRun" ALTER COLUMN ordinal SET NOT NULL,
 ALTER COLUMN ordinal SET DEFAULT 1,
 ADD CONSTRAINT "FileExtractionRun_ordinal_positive" CHECK (ordinal>0);
CREATE UNIQUE INDEX "FileExtractionRun_installationId_versionId_ordinal_key"
 ON "FileExtractionRun"("installationId","versionId",ordinal);
ALTER TABLE "FileIndex" ADD COLUMN "chunkBytes" INTEGER NOT NULL DEFAULT 4096
 CHECK ("chunkBytes" BETWEEN 4 AND 4096);
ALTER TABLE "FileIndex" DROP CONSTRAINT "FileIndex_configurationVersion_check",
 ADD CONSTRAINT "FileIndex_configurationVersion_check"
 CHECK ("configurationVersion" IN ('file-index-d04-v1','file-index-d04-v2'));
-- V1 data remains intact, but is stale under v2's explicit whitespace contract.
