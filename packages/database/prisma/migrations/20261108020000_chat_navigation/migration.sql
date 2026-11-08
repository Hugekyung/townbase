-- Chat navigation reads recent attachment metadata without loading result bodies.
CREATE INDEX "AttachmentTask_owner_recent_idx" ON "AttachmentTask"("installationId","ownerAdministratorId","createdAt","requestId");
