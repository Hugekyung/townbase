-- Preserve the already published authentication migration checksum.
BEGIN;
CREATE INDEX "AdministratorSession_installation_revoked_idx" ON "AdministratorSession"("installationId", "revokedAt");
DROP INDEX "AdministratorSession_owner_revoked_idx";
COMMIT;
