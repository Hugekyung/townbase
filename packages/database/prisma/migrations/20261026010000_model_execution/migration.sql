ALTER TYPE "InstallationAuditAction" ADD VALUE 'model_execution_settings_changed';
CREATE TABLE "ModelExecutionSettings" (
  "installationId" TEXT NOT NULL PRIMARY KEY REFERENCES "Installation"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "answerModel" VARCHAR(64) NOT NULL DEFAULT 'gpt-6-luna',
  reasoning VARCHAR(16) NOT NULL DEFAULT 'low',
  "inputTokenLimit" INTEGER NOT NULL DEFAULT 16000,
  "outputTokenLimit" INTEGER NOT NULL DEFAULT 4096,
  "monthlyBudgetNanoUsd" BIGINT,
  "priceVersion" VARCHAR(64),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ModelExecutionSettings_values_check" CHECK (
    "installationId"='primary' AND "answerModel" IN ('gpt-6-luna','gpt-6.1-sol') AND
    reasoning IN ('none','low','medium','high','xhigh','max') AND
    NOT ("answerModel"='gpt-6.1-sol' AND reasoning='none') AND
    "inputTokenLimit" BETWEEN 512 AND 16000 AND "outputTokenLimit" BETWEEN 128 AND 4096 AND
    ("monthlyBudgetNanoUsd" IS NULL OR "monthlyBudgetNanoUsd" BETWEEN 1 AND 99999999999999)
  )
);
CREATE TABLE "ModelCall" (
  "installationId" TEXT NOT NULL REFERENCES "Installation"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "requestId" UUID NOT NULL,
  "ownerAdministratorId" TEXT NOT NULL,
  purpose VARCHAR(32) NOT NULL,
  model VARCHAR(64) NOT NULL,
  "credentialTag" VARCHAR(22) NOT NULL,
  "inputDigest" VARCHAR(64) NOT NULL,
  "configurationDigest" VARCHAR(64) NOT NULL,
  "priceVersion" VARCHAR(64) NOT NULL,
  "reservedNanoUsd" BIGINT NOT NULL,
  "chargedNanoUsd" BIGINT,
  status VARCHAR(16) NOT NULL,
  "errorCode" VARCHAR(64),
  usage JSONB,
  "providerId" VARCHAR(200),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deadlineAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "ModelCall_pkey" PRIMARY KEY ("installationId","requestId"),
  CONSTRAINT "ModelCall_owner_fkey" FOREIGN KEY ("installationId","ownerAdministratorId") REFERENCES "Administrator"("installationId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ModelCall_values_check" CHECK (
    "installationId"='primary' AND purpose IN ('document_embedding','rag_question_embedding','rag_answer','attachment_answer','check_answer','check_embedding') AND
    model IN ('gpt-6-luna','gpt-6.1-sol','text-embedding-3-small') AND
    status IN ('dispatching','succeeded','incomplete','unknown','not_sent') AND
    "reservedNanoUsd">0 AND ("chargedNanoUsd" IS NULL OR "chargedNanoUsd">=0) AND
    "inputDigest" ~ '^[a-f0-9]{64}$' AND "configurationDigest" ~ '^[a-f0-9]{64}$' AND
    "deadlineAt">"createdAt" AND
    ((status IN ('dispatching','unknown') AND "chargedNanoUsd" IS NULL) OR
     (status='not_sent' AND "chargedNanoUsd"=0 AND usage IS NULL AND "completedAt" IS NOT NULL) OR
     (status IN ('succeeded','incomplete') AND "chargedNanoUsd" IS NOT NULL AND usage IS NOT NULL AND "completedAt" IS NOT NULL))
  )
);
CREATE INDEX "ModelCall_installationId_createdAt_idx" ON "ModelCall"("installationId","createdAt");
