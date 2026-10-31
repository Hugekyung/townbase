-- Preserve the applied D03 migration; strengthen relationship and state contracts.
CREATE UNIQUE INDEX "FileVersion_installationId_originalId_id_key" ON "FileVersion"("installationId","originalId",id);
CREATE UNIQUE INDEX "FileExtractionRun_installationId_versionId_id_key" ON "FileExtractionRun"("installationId","versionId",id);
ALTER TABLE "FileRun"
 DROP CONSTRAINT "FileRun_installationId_baseVersionId_fkey",
 DROP CONSTRAINT "FileRun_installationId_resultVersionId_fkey",
 DROP CONSTRAINT "FileRun_installationId_resultExtractionRunId_fkey",
 ADD CONSTRAINT "FileRun_installationId_targetOriginalId_baseVersionId_fkey"
  FOREIGN KEY ("installationId","targetOriginalId","baseVersionId") REFERENCES "FileVersion"("installationId","originalId",id) ON DELETE RESTRICT,
 ADD CONSTRAINT "FileRun_installationId_resultOriginalId_resultVersionId_fkey"
  FOREIGN KEY ("installationId","resultOriginalId","resultVersionId") REFERENCES "FileVersion"("installationId","originalId",id) ON DELETE RESTRICT,
 ADD CONSTRAINT "FileRun_installationId_resultVersionId_resultExtractionRunId_fkey"
  FOREIGN KEY ("installationId","resultVersionId","resultExtractionRunId") REFERENCES "FileExtractionRun"("installationId","versionId",id) ON DELETE RESTRICT,
 ADD CONSTRAINT "FileRun_operation_trigger_contract" CHECK ("trigger"='retry' OR "trigger"="operation"),
 ADD CONSTRAINT "FileRun_uncompleted_result_contract" CHECK (
  "status" NOT IN ('queued','running','interrupted') OR
  ("resultOriginalId" IS NULL AND "resultVersionId" IS NULL AND "resultExtractionRunId" IS NULL)
 );
