-- Tombstone first; physical cleanup is independently retryable after a crash.
ALTER TABLE "FileOriginal" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "FileVersion" ADD COLUMN "rawDeletedAt" TIMESTAMP(3);
ALTER TABLE "FileVersion" ADD CONSTRAINT "FileVersion_raw_deleted_check"
  CHECK ("rawDeletedAt" IS NULL OR "extraction" IS NULL);
CREATE INDEX "FileOriginal_installationId_ownerAdministratorId_id_idx"
  ON "FileOriginal" ("installationId", "ownerAdministratorId", "id") WHERE "deletedAt" IS NULL;
