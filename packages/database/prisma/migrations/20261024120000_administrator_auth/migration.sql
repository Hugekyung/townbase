ALTER TYPE "InstallationAuditAction" ADD VALUE 'administrator_logged_in';
ALTER TYPE "InstallationAuditAction" ADD VALUE 'administrator_login_rejected';
ALTER TYPE "InstallationAuditAction" ADD VALUE 'administrator_logged_out';
ALTER TYPE "InstallationAuditAction" ADD VALUE 'administrator_password_changed';
ALTER TYPE "InstallationAuditAction" ADD VALUE 'recovery_token_issued';
ALTER TYPE "InstallationAuditAction" ADD VALUE 'recovery_token_rejected';
ALTER TYPE "InstallationAuditAction" ADD VALUE 'recovery_token_consumed';
CREATE TABLE "AuthenticationState" (
  "id" TEXT PRIMARY KEY DEFAULT 'primary' CHECK ("id" = 'primary'),
  "loginFailures" INTEGER NOT NULL DEFAULT 0 CHECK ("loginFailures" >= 0),
  "loginWindowStart" TIMESTAMP(3),
  "loginBlockedUntil" TIMESTAMP(3),
  "recoveryHash" VARCHAR(64),
  "recoveryIssuedAt" TIMESTAMP(3),
  "recoveryExpiresAt" TIMESTAMP(3),
  "recoveryConsumedAt" TIMESTAMP(3),
  "recoveryFailures" INTEGER NOT NULL DEFAULT 0 CHECK ("recoveryFailures" >= 0),
  "recoveryWindowStart" TIMESTAMP(3),
  "recoveryBlockedUntil" TIMESTAMP(3),
  CHECK ("recoveryHash" IS NULL OR ("recoveryHash" ~ '^[0-9a-f]{64}$' AND "recoveryIssuedAt" IS NOT NULL AND "recoveryExpiresAt" IS NOT NULL AND "recoveryExpiresAt" > "recoveryIssuedAt" AND "recoveryConsumedAt" IS NULL))
);
INSERT INTO "AuthenticationState" ("id") VALUES ('primary');
CREATE TABLE "AdministratorSession" (
  "tokenHash" VARCHAR(64) PRIMARY KEY CHECK ("tokenHash" ~ '^[0-9a-f]{64}$'),
  "installationId" TEXT NOT NULL CHECK ("installationId" = 'primary'),
  "administratorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  CHECK ("expiresAt" > "createdAt" AND "lastSeenAt" >= "createdAt" AND "lastSeenAt" <= "expiresAt"),
  FOREIGN KEY ("installationId", "administratorId") REFERENCES "Administrator"("installationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "AdministratorSession_owner_revoked_idx" ON "AdministratorSession"("installationId", "administratorId", "revokedAt");
