-- Additive only: legacy workspaces/documents are not claimed or rewritten.
CREATE TYPE "AuditActorType" AS ENUM ('server', 'administrator');
CREATE TYPE "InstallationAuditAction" AS ENUM ('installation_created', 'installation_settings_changed', 'administrator_created');
CREATE TYPE "AuditOutcome" AS ENUM ('succeeded', 'failed');

CREATE TABLE "Installation" (
    "id" TEXT NOT NULL DEFAULT 'primary',
    "workspaceId" TEXT NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "timeZone" VARCHAR(64) NOT NULL,
    "initializedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Installation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Installation_singleton_check" CHECK ("id" = 'primary'),
    CONSTRAINT "Installation_name_check" CHECK (length(btrim("name")) > 0),
    CONSTRAINT "Installation_timeZone_check" CHECK (length(btrim("timeZone")) > 0)
);

CREATE TABLE "Administrator" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "username" VARCHAR(128) NOT NULL,
    "passwordHash" VARCHAR(512) NOT NULL,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Administrator_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Administrator_username_check" CHECK (length(btrim("username")) > 0),
    -- Encoded Argon2id only. Actual hashing, password checks and cost policy
    -- belong to bootstrap/auth, not this migration or a seeded password.
    CONSTRAINT "Administrator_passwordHash_check" CHECK (
        "passwordHash" ~ '^\$argon2id\$v=19\$m=[0-9]+,t=[0-9]+,p=[0-9]+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$'
    )
);

CREATE TABLE "InstallationAuditEvent" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "actorType" "AuditActorType" NOT NULL,
    "actorAdministratorId" TEXT,
    "action" "InstallationAuditAction" NOT NULL,
    "outcome" "AuditOutcome" NOT NULL,
    "requestId" VARCHAR(128) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InstallationAuditEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "InstallationAuditEvent_actor_check" CHECK (
        ("actorType" = 'server' AND "actorAdministratorId" IS NULL)
        OR ("actorType" = 'administrator' AND "actorAdministratorId" IS NOT NULL)
    ),
    CONSTRAINT "InstallationAuditEvent_requestId_check" CHECK (length(btrim("requestId")) > 0)
);

CREATE UNIQUE INDEX "Installation_workspaceId_key" ON "Installation"("workspaceId");
CREATE UNIQUE INDEX "Administrator_installationId_key" ON "Administrator"("installationId");
CREATE UNIQUE INDEX "Administrator_installationId_id_key" ON "Administrator"("installationId", "id");
CREATE INDEX "InstallationAuditEvent_installationId_occurredAt_idx" ON "InstallationAuditEvent"("installationId", "occurredAt");
CREATE INDEX "InstallationAuditEvent_installationId_requestId_idx" ON "InstallationAuditEvent"("installationId", "requestId");

-- Restrict ownership deletes: an account/settings operation must not cascade
-- into an existing workspace or erase its audit trail.
ALTER TABLE "Installation" ADD CONSTRAINT "Installation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Administrator" ADD CONSTRAINT "Administrator_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "Installation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InstallationAuditEvent" ADD CONSTRAINT "InstallationAuditEvent_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "Installation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InstallationAuditEvent" ADD CONSTRAINT "InstallationAuditEvent_installationId_actorAdministratorId_fkey" FOREIGN KEY ("installationId", "actorAdministratorId") REFERENCES "Administrator"("installationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
