ALTER TYPE "InstallationAuditAction" ADD VALUE 'bootstrap_token_issued';
ALTER TYPE "InstallationAuditAction" ADD VALUE 'bootstrap_token_consumed';
ALTER TYPE "InstallationAuditAction" ADD VALUE 'bootstrap_token_rejected';

CREATE TABLE "BootstrapState" (
  "id" TEXT NOT NULL DEFAULT 'primary',
  "tokenHash" VARCHAR(64),
  "issuedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3),
  "failedAttempts" INTEGER NOT NULL DEFAULT 0,
  "attemptWindowStart" TIMESTAMP(3),
  "blockedUntil" TIMESTAMP(3),
  CONSTRAINT "BootstrapState_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BootstrapState_singleton" CHECK ("id" = 'primary'),
  CONSTRAINT "BootstrapState_attempts" CHECK ("failedAttempts" >= 0),
  CONSTRAINT "BootstrapState_hash" CHECK ("tokenHash" IS NULL OR "tokenHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "BootstrapState_credential" CHECK (
    "tokenHash" IS NULL OR ("issuedAt" IS NOT NULL AND "expiresAt" IS NOT NULL AND "expiresAt" > "issuedAt" AND "consumedAt" IS NULL)
  )
);
INSERT INTO "BootstrapState" ("id") VALUES ('primary');

-- PHC parameter order is not semantically significant. node-argon2 0.45.1
-- serializes m,p,t; retain compatibility with existing m,t,p encoded hashes.
ALTER TABLE "Administrator" DROP CONSTRAINT "Administrator_passwordHash_check";
ALTER TABLE "Administrator" ADD CONSTRAINT "Administrator_passwordHash_check" CHECK (
  "passwordHash" ~ '^\$argon2id\$v=19\$m=[0-9]+,(t=[0-9]+,p=[0-9]+|p=[0-9]+,t=[0-9]+)\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$'
);
