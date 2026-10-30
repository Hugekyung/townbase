CREATE UNIQUE INDEX "FileExtractionRun_installationId_id_key" ON "FileExtractionRun"("installationId",id);
CREATE TABLE "FileRun" (
 "id" UUID PRIMARY KEY, "installationId" TEXT NOT NULL, "ownerAdministratorId" TEXT NOT NULL,
 "operation" VARCHAR(16) NOT NULL, "trigger" VARCHAR(16) NOT NULL, "targetKey" VARCHAR(80) NOT NULL,
 "targetOriginalId" UUID, "baseVersionId" UUID, "retryOfId" UUID,
 "fileName" VARCHAR(255) NOT NULL, "format" VARCHAR(8) NOT NULL, "byteSize" INTEGER NOT NULL,
 "contentHash" VARCHAR(64) NOT NULL, "inputKey" VARCHAR(80) UNIQUE,
 "configurationVersion" VARCHAR(64) NOT NULL, "status" VARCHAR(16) NOT NULL, "errorCode" VARCHAR(64),
 "resultOriginalId" UUID, "resultVersionId" UUID, "resultExtractionRunId" UUID,
 "createdCount" INTEGER NOT NULL DEFAULT 0, "updatedCount" INTEGER NOT NULL DEFAULT 0,
 "excludedCount" INTEGER NOT NULL DEFAULT 0, "unchangedCount" INTEGER NOT NULL DEFAULT 0, "failedCount" INTEGER NOT NULL DEFAULT 0,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "startedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3),
 UNIQUE ("installationId","id"),
 CONSTRAINT "FileRun_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "Installation"("id") ON DELETE RESTRICT,
 CONSTRAINT "FileRun_installationId_ownerAdministratorId_fkey" FOREIGN KEY ("installationId","ownerAdministratorId") REFERENCES "Administrator"("installationId","id") ON DELETE RESTRICT,
 CONSTRAINT "FileRun_installationId_targetOriginalId_fkey" FOREIGN KEY ("installationId","targetOriginalId") REFERENCES "FileOriginal"("installationId","id") ON DELETE RESTRICT,
 CONSTRAINT "FileRun_installationId_baseVersionId_fkey" FOREIGN KEY ("installationId","baseVersionId") REFERENCES "FileVersion"("installationId","id") ON DELETE RESTRICT,
 CONSTRAINT "FileRun_installationId_resultOriginalId_fkey" FOREIGN KEY ("installationId","resultOriginalId") REFERENCES "FileOriginal"("installationId","id") ON DELETE RESTRICT,
 CONSTRAINT "FileRun_installationId_resultVersionId_fkey" FOREIGN KEY ("installationId","resultVersionId") REFERENCES "FileVersion"("installationId","id") ON DELETE RESTRICT,
 CONSTRAINT "FileRun_installationId_resultExtractionRunId_fkey" FOREIGN KEY ("installationId","resultExtractionRunId") REFERENCES "FileExtractionRun"("installationId","id") ON DELETE RESTRICT,
 CONSTRAINT "FileRun_contract" CHECK (
  "operation" IN ('register','replace','reprocess') AND "trigger" IN ('register','replace','reprocess','retry')
  AND "format" IN ('pdf','docx','md','txt') AND "byteSize" BETWEEN 1 AND 20971520
  AND "contentHash" ~ '^[0-9a-f]{64}$' AND length("fileName") BETWEEN 1 AND 255
  AND ("inputKey" IS NULL OR "inputKey" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.bin$')
  AND (("operation"='register' AND "targetOriginalId" IS NULL AND "baseVersionId" IS NULL)
    OR ("operation" IN ('replace','reprocess') AND "targetOriginalId" IS NOT NULL AND "baseVersionId" IS NOT NULL))
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
  AND ("status" NOT IN ('queued','running') OR "operation"='reprocess' OR "inputKey" IS NOT NULL)
  AND ("status" NOT IN ('queued','running') OR ("errorCode" IS NULL AND "createdCount"+"updatedCount"+"excludedCount"+"unchangedCount"+"failedCount"=0))
 )
);
CREATE UNIQUE INDEX "FileRun_active_target" ON "FileRun"("installationId","targetKey") WHERE status IN ('queued','running');
CREATE UNIQUE INDEX "FileRun_one_running" ON "FileRun"("installationId") WHERE status='running';
CREATE INDEX "FileRun_installationId_status_createdAt_id_idx" ON "FileRun"("installationId",status,"createdAt",id);
CREATE INDEX "FileRun_installationId_ownerAdministratorId_createdAt_id_idx" ON "FileRun"("installationId","ownerAdministratorId","createdAt",id);
CREATE INDEX "FileRun_completedAt_idx" ON "FileRun"("completedAt");
CREATE TABLE "FileRunRequest" (
 "installationId" TEXT NOT NULL, "requestId" UUID NOT NULL, "runId" UUID NOT NULL,
 "fingerprint" VARCHAR(64) NOT NULL CHECK ("fingerprint" ~ '^[0-9a-f]{64}$'), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("installationId","requestId"),
 FOREIGN KEY ("installationId","runId") REFERENCES "FileRun"("installationId","id") ON DELETE RESTRICT
);
CREATE INDEX "FileRunRequest_installationId_runId_idx" ON "FileRunRequest"("installationId","runId");
