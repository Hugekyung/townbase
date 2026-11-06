ALTER TYPE "InstallationAuditAction" ADD VALUE 'agent_settings_changed';

CREATE TABLE "BasicAgent" (
  "installationId" TEXT NOT NULL PRIMARY KEY REFERENCES "Installation"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  id UUID NOT NULL UNIQUE,
  "ownerAdministratorId" TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  name VARCHAR(128) NOT NULL,
  purpose VARCHAR(512) NOT NULL,
  instructions VARCHAR(2000) NOT NULL,
  terminology JSONB NOT NULL,
  "sourceSelection" VARCHAR(16) NOT NULL,
  "sourceOriginalIds" UUID[] NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BasicAgent_owner_fkey" FOREIGN KEY ("installationId", "ownerAdministratorId") REFERENCES "Administrator"("installationId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BasicAgent_values_check" CHECK (
    "installationId"='primary' AND revision > 0 AND
    length(btrim(name)) > 0 AND length(btrim(purpose)) > 0 AND
    "sourceSelection" IN ('all','selected') AND cardinality("sourceOriginalIds") <= 200 AND
    array_position("sourceOriginalIds",NULL) IS NULL AND
    ("sourceSelection" <> 'all' OR cardinality("sourceOriginalIds")=0) AND
    CASE WHEN jsonb_typeof(terminology)='array' THEN jsonb_array_length(terminology)<=30 ELSE false END
  )
);
