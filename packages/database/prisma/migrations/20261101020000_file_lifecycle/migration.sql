ALTER TYPE "InstallationAuditAction" ADD VALUE 'file_scope_changed';
ALTER TABLE "FileOriginal" ADD COLUMN "excludedAt" TIMESTAMP(3),
 ADD COLUMN "scopeRevision" INTEGER NOT NULL DEFAULT 1 CHECK ("scopeRevision">0);
ALTER TABLE "FileIndex" ADD COLUMN "scopeRevision" INTEGER NOT NULL DEFAULT 1 CHECK ("scopeRevision">0);
