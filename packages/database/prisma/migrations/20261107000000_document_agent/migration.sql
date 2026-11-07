CREATE TABLE "RagConversation" (
 id UUID PRIMARY KEY,
 "installationId" TEXT NOT NULL REFERENCES "Installation"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "ownerAdministratorId" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("installationId","ownerAdministratorId",id),
 FOREIGN KEY ("installationId","ownerAdministratorId") REFERENCES "Administrator"("installationId",id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "RagTurn" (
 "installationId" TEXT NOT NULL REFERENCES "Installation"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "requestId" UUID NOT NULL,
 "ownerAdministratorId" TEXT NOT NULL,
 "conversationId" UUID NOT NULL,
 "agentId" UUID NOT NULL,
 "agentRevision" INTEGER NOT NULL CHECK ("agentRevision">0),
 "executionDigest" VARCHAR(64) NOT NULL CHECK ("executionDigest" ~ '^[a-f0-9]{64}$'),
 fingerprint VARCHAR(64) NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
 question TEXT NOT NULL CHECK (length(question) BETWEEN 1 AND 4000),
 "requestedMode" "RetrievalMode" NOT NULL,
 "resolvedMode" "RetrievalMode" NOT NULL,
 "historyRequestIds" UUID[] NOT NULL,
 "configuredModel" VARCHAR(64) NOT NULL,
 model VARCHAR(64),
 status VARCHAR(16) NOT NULL CHECK (status IN ('running','answered','refused','failed','interrupted')),
 "errorCode" VARCHAR(64),
 sources JSONB NOT NULL DEFAULT '[]',
 result JSONB,
 answer TEXT,
 "embeddingRequestId" UUID NOT NULL,
 "answerRequestId" UUID NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "deadlineAt" TIMESTAMP(3) NOT NULL,
 "completedAt" TIMESTAMP(3),
 "expiresAt" TIMESTAMP(3) NOT NULL,
 PRIMARY KEY ("installationId","requestId"),
 FOREIGN KEY ("installationId","ownerAdministratorId") REFERENCES "Administrator"("installationId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY ("installationId","ownerAdministratorId","conversationId") REFERENCES "RagConversation"("installationId","ownerAdministratorId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CHECK ("requestedMode" IN ('auto','onboarding','product_history','documentation_gap') AND "resolvedMode" IN ('onboarding','product_history','documentation_gap')),
 CHECK ("configuredModel" IN ('gpt-6-luna','gpt-6.1-sol') AND (model IS NULL OR model IN ('gpt-6-luna','gpt-6.1-sol'))),
 CHECK (cardinality("historyRequestIds")<=3 AND array_position("historyRequestIds",NULL) IS NULL),
 CHECK (CASE WHEN jsonb_typeof(sources)='array' THEN jsonb_array_length(sources)<=20 ELSE false END),
 CHECK ("deadlineAt">"createdAt" AND "expiresAt">"deadlineAt"),
 CHECK ((status='running' AND "completedAt" IS NULL AND answer IS NULL AND result IS NULL AND "errorCode" IS NULL)
     OR (status='answered' AND "completedAt" IS NOT NULL AND answer IS NOT NULL AND result IS NOT NULL AND model IS NOT NULL AND "errorCode" IS NULL)
     OR (status='refused' AND "completedAt" IS NOT NULL AND answer IS NOT NULL AND result IS NOT NULL AND "errorCode" IS NULL)
     OR (status IN ('failed','interrupted') AND "completedAt" IS NOT NULL AND answer IS NULL AND result IS NULL AND "errorCode" IS NOT NULL))
);
CREATE UNIQUE INDEX "RagTurn_one_running" ON "RagTurn"("installationId") WHERE status='running';
CREATE INDEX "RagTurn_installation_status_created" ON "RagTurn"("installationId",status,"createdAt");
CREATE INDEX "RagTurn_conversation_created" ON "RagTurn"("installationId","ownerAdministratorId","conversationId","createdAt");
CREATE INDEX "RagTurn_expires" ON "RagTurn"("expiresAt");
CREATE TABLE "RagGap" (
 id UUID PRIMARY KEY,
 "installationId" TEXT NOT NULL REFERENCES "Installation"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "ownerAdministratorId" TEXT NOT NULL,
 "turnRequestId" UUID NOT NULL,
 question TEXT NOT NULL CHECK (length(question) BETWEEN 1 AND 4000),
 "requestedMode" "RetrievalMode" NOT NULL,
 "resolvedMode" "RetrievalMode" NOT NULL,
 reason TEXT NOT NULL,
 "sourceRefs" JSONB NOT NULL CHECK (jsonb_typeof("sourceRefs")='array'),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("installationId","turnRequestId"),
 FOREIGN KEY ("installationId","ownerAdministratorId") REFERENCES "Administrator"("installationId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CHECK ("requestedMode" IN ('auto','onboarding','product_history','documentation_gap') AND "resolvedMode" IN ('onboarding','product_history','documentation_gap'))
);
CREATE INDEX "RagGap_owner" ON "RagGap"("installationId","ownerAdministratorId",id);
