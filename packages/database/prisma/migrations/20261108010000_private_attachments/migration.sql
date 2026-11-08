CREATE TABLE "AttachmentTask" (
 "installationId" TEXT NOT NULL REFERENCES "Installation"(id) ON DELETE RESTRICT,
 "requestId" UUID NOT NULL,
 "ownerAdministratorId" TEXT NOT NULL,
 fingerprint VARCHAR(64) NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
 "agentId" UUID NOT NULL,
 "agentRevision" INTEGER NOT NULL CHECK ("agentRevision">0),
 "executionDigest" VARCHAR(64) NOT NULL CHECK ("executionDigest" ~ '^[0-9a-f]{64}$'),
 operation VARCHAR(16) NOT NULL CHECK(operation IN ('summary','question','draft')),
 question TEXT NOT NULL CHECK(length(question) BETWEEN 1 AND 4000),
 "ragQuestion" TEXT CHECK("ragQuestion" IS NULL OR length("ragQuestion") BETWEEN 1 AND 4000),
 "requestedMode" "RetrievalMode" NOT NULL,
 "resolvedMode" "RetrievalMode" NOT NULL,
 "attachmentIds" UUID[] NOT NULL CHECK(cardinality("attachmentIds") BETWEEN 1 AND 3 AND array_position("attachmentIds",NULL) IS NULL),
 "historyRequestIds" UUID[] NOT NULL CHECK(cardinality("historyRequestIds")<=3 AND array_position("historyRequestIds",NULL) IS NULL),
 status VARCHAR(16) NOT NULL CHECK(status IN ('running','answered','refused','failed','interrupted')),
 "errorCode" VARCHAR(64),
 "ragSources" JSONB NOT NULL DEFAULT '[]' CHECK(CASE WHEN jsonb_typeof("ragSources")='array' THEN jsonb_array_length("ragSources")<=20 ELSE false END),
 "attachmentSources" JSONB NOT NULL DEFAULT '[]' CHECK(CASE WHEN jsonb_typeof("attachmentSources")='array' THEN jsonb_array_length("attachmentSources")<=256 ELSE false END),
 result JSONB, answer TEXT, model VARCHAR(64),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "deadlineAt" TIMESTAMP(3) NOT NULL,
 "completedAt" TIMESTAMP(3), "expiresAt" TIMESTAMP(3) NOT NULL,
 PRIMARY KEY("installationId","requestId"),
 UNIQUE("installationId","ownerAdministratorId","requestId"),
 FOREIGN KEY("installationId","ownerAdministratorId") REFERENCES "Administrator"("installationId",id) ON DELETE RESTRICT,
 CHECK("requestedMode" IN ('auto','onboarding','product_history','documentation_gap') AND "resolvedMode" IN ('onboarding','product_history','documentation_gap')),
 CHECK(model IS NULL OR model IN ('gpt-6-luna','gpt-6.1-sol')),
 CHECK("deadlineAt">"createdAt" AND "expiresAt">"deadlineAt"),
 CHECK((status='running' AND "completedAt" IS NULL AND result IS NULL AND answer IS NULL AND "errorCode" IS NULL)
 OR (status='answered' AND "completedAt" IS NOT NULL AND result IS NOT NULL AND answer IS NOT NULL AND model IS NOT NULL AND "errorCode" IS NULL)
 OR (status='refused' AND "completedAt" IS NOT NULL AND result IS NOT NULL AND answer IS NOT NULL AND "errorCode" IS NULL)
 OR (status IN ('failed','interrupted') AND "completedAt" IS NOT NULL AND result IS NULL AND answer IS NULL AND "errorCode" IS NOT NULL))
);
CREATE UNIQUE INDEX "AttachmentTask_one_running" ON "AttachmentTask"("installationId") WHERE status='running';
CREATE INDEX "AttachmentTask_expiresAt_idx" ON "AttachmentTask"("expiresAt");
CREATE TABLE "Attachment" (
 id UUID PRIMARY KEY,
 "installationId" TEXT NOT NULL REFERENCES "Installation"(id) ON DELETE RESTRICT,
 "ownerAdministratorId" TEXT NOT NULL,
 "taskRequestId" UUID,
 "fileName" TEXT NOT NULL,
 format VARCHAR(8) NOT NULL CHECK(format IN ('pdf','docx','md','txt')),
 "byteSize" INTEGER NOT NULL CHECK("byteSize" BETWEEN 1 AND 10485760),
 "contentHash" VARCHAR(64) NOT NULL CHECK("contentHash" ~ '^[0-9a-f]{64}$'),
 "storageKey" TEXT NOT NULL UNIQUE CHECK("storageKey" ~ '^[0-9a-f-]{36}\.bin$'),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "expiresAt" TIMESTAMP(3) NOT NULL,
 "blockedAt" TIMESTAMP(3), "rawDeletedAt" TIMESTAMP(3),
 FOREIGN KEY("installationId","ownerAdministratorId") REFERENCES "Administrator"("installationId",id) ON DELETE RESTRICT,
 FOREIGN KEY("installationId","ownerAdministratorId","taskRequestId") REFERENCES "AttachmentTask"("installationId","ownerAdministratorId","requestId") ON DELETE RESTRICT,
 CHECK("expiresAt">"createdAt" AND "expiresAt"<="createdAt"+interval '60 minutes'),
 CHECK("rawDeletedAt" IS NULL OR "blockedAt" IS NOT NULL)
);
CREATE INDEX "Attachment_owner_expires_idx" ON "Attachment"("installationId","ownerAdministratorId","expiresAt");
