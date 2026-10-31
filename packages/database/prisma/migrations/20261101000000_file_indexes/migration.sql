CREATE UNIQUE INDEX "FileOriginal_installationId_ownerAdministratorId_id_key" ON "FileOriginal"("installationId","ownerAdministratorId",id);
CREATE TABLE "FileIndex" (
 id UUID PRIMARY KEY, "installationId" TEXT NOT NULL, "ownerAdministratorId" TEXT NOT NULL,
 "originalId" UUID NOT NULL, "versionId" UUID NOT NULL, "originRunId" UUID NOT NULL,
 "extractionDigest" VARCHAR(64) NOT NULL CHECK ("extractionDigest" ~ '^[0-9a-f]{64}$'),
 "configurationVersion" VARCHAR(64) NOT NULL CHECK ("configurationVersion"='file-index-d04-v1'),
 "embeddingModel" VARCHAR(64) NOT NULL CHECK ("embeddingModel"='text-embedding-3-small'),
 "chunkCount" INTEGER NOT NULL CHECK ("chunkCount">0), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("installationId",id), UNIQUE ("installationId","versionId"),
 FOREIGN KEY ("installationId","ownerAdministratorId","originalId") REFERENCES "FileOriginal"("installationId","ownerAdministratorId",id) ON DELETE RESTRICT,
 FOREIGN KEY ("installationId","originalId","versionId") REFERENCES "FileVersion"("installationId","originalId",id) ON DELETE RESTRICT
);
CREATE TABLE "FileIndexChunk" (
 id UUID PRIMARY KEY, "installationId" TEXT NOT NULL, "indexId" UUID NOT NULL,
 ordinal INTEGER NOT NULL CHECK (ordinal>=0), content TEXT NOT NULL CHECK (length(btrim(content))>0 AND octet_length(content)<=4096),
 "contentHash" VARCHAR(64) NOT NULL CHECK ("contentHash" ~ '^[0-9a-f]{64}$'),
 "headingPath" JSONB NOT NULL CHECK (jsonb_typeof("headingPath")='array'),
 locations JSONB NOT NULL CHECK (jsonb_typeof(locations)='array' AND jsonb_array_length(locations)>0),
 "sourceType" "SourceType" NOT NULL DEFAULT 'uploaded_file' CHECK ("sourceType"='uploaded_file'),
 "knowledgeTypes" "KnowledgeType"[] NOT NULL, "domainTags" TEXT[] NOT NULL,
 status "DocumentStatus" NOT NULL, "sourcePriority" INTEGER NOT NULL CHECK ("sourcePriority" BETWEEN 0 AND 100),
 "requestedMode" "RetrievalMode", "resolvedMode" "RetrievalMode",
 "modelCallRequestId" UUID NOT NULL,
 embedding vector(1536) NOT NULL CHECK ((embedding <#> embedding)< -1e-30 AND (embedding <#> embedding)> -1e30),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("installationId","indexId",ordinal),
 FOREIGN KEY ("installationId","indexId") REFERENCES "FileIndex"("installationId",id) ON DELETE CASCADE,
 FOREIGN KEY ("installationId","modelCallRequestId") REFERENCES "ModelCall"("installationId","requestId") ON DELETE RESTRICT
);
ALTER TABLE "FileRun" DROP CONSTRAINT "FileRun_contract", ADD CONSTRAINT "FileRun_contract" CHECK (
  "operation" IN ('register','replace','reprocess','index') AND "trigger" IN ('register','replace','reprocess','index','retry')
  AND "format" IN ('pdf','docx','md','txt') AND "byteSize" BETWEEN 1 AND 20971520
  AND "contentHash" ~ '^[0-9a-f]{64}$' AND length("fileName") BETWEEN 1 AND 255
  AND ("inputKey" IS NULL OR "inputKey" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.bin$')
  AND (("operation"='register' AND "targetOriginalId" IS NULL AND "baseVersionId" IS NULL)
    OR ("operation" IN ('replace','reprocess','index') AND "targetOriginalId" IS NOT NULL AND "baseVersionId" IS NOT NULL))
  AND (("status"='queued' AND "startedAt" IS NULL AND "completedAt" IS NULL)
    OR ("status"='running' AND "startedAt" IS NOT NULL AND "completedAt" IS NULL)
    OR ("status" IN ('succeeded','failed','interrupted') AND "completedAt" IS NOT NULL))
  AND ("startedAt" IS NULL OR "startedAt">="createdAt")
  AND ("completedAt" IS NULL OR "completedAt">=COALESCE("startedAt","createdAt"))
  AND "createdCount">=0 AND "updatedCount">=0 AND "excludedCount">=0 AND "unchangedCount">=0 AND "failedCount">=0
  AND "createdCount"+"updatedCount"+"excludedCount"+"unchangedCount"+"failedCount"<=1
  AND (("resultOriginalId" IS NULL)=("resultVersionId" IS NULL))
  AND (("resultOriginalId" IS NULL)=("resultExtractionRunId" IS NULL))
  AND (("trigger"='retry')=("retryOfId" IS NOT NULL))
  AND ("status"<>'succeeded' OR ("errorCode" IS NULL AND "resultVersionId" IS NOT NULL AND "createdCount"+"updatedCount"+"unchangedCount"=1))
  AND ("status" NOT IN ('failed','interrupted') OR "errorCode" IS NOT NULL)
  AND ("status" NOT IN ('queued','running') OR "operation" IN ('reprocess','index') OR "inputKey" IS NOT NULL)
  AND ("status" NOT IN ('queued','running') OR ("errorCode" IS NULL AND "createdCount"+"updatedCount"+"excludedCount"+"unchangedCount"+"failedCount"=0))
 );
