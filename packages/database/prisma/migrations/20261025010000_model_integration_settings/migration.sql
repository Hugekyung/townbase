ALTER TYPE "InstallationAuditAction" ADD VALUE 'answer_key_updated';
ALTER TYPE "InstallationAuditAction" ADD VALUE 'answer_key_disabled';
ALTER TYPE "InstallationAuditAction" ADD VALUE 'answer_key_deleted';
ALTER TYPE "InstallationAuditAction" ADD VALUE 'embedding_key_updated';
ALTER TYPE "InstallationAuditAction" ADD VALUE 'embedding_key_disabled';
ALTER TYPE "InstallationAuditAction" ADD VALUE 'embedding_key_deleted';
ALTER TYPE "InstallationAuditAction" ADD VALUE 'model_transfer_policy_changed';
CREATE TYPE "ModelCredentialPurpose" AS ENUM ('answer', 'embedding');
CREATE TABLE "ModelCredential" (
  "installationId" TEXT NOT NULL,
  purpose "ModelCredentialPurpose" NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  "formatVersion" INTEGER NOT NULL,
  "keyId" VARCHAR(64) NOT NULL,
  nonce VARCHAR(16) NOT NULL,
  ciphertext VARCHAR(1024) NOT NULL,
  tag VARCHAR(22) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ModelCredential_pkey" PRIMARY KEY ("installationId", purpose),
  CONSTRAINT "ModelCredential_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "Installation"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ModelCredential_primary_check" CHECK ("installationId" = 'primary'),
  CONSTRAINT "ModelCredential_envelope_check" CHECK (
    "formatVersion" = 1 AND "keyId" ~ '^[a-f0-9]{64}$' AND
    nonce ~ '^[A-Za-z0-9_-]{16}$' AND tag ~ '^[A-Za-z0-9_-]{22}$' AND
    ciphertext ~ '^[A-Za-z0-9_-]+$' AND length(ciphertext) BETWEEN 22 AND 683
  )
);
CREATE TABLE "ModelTransferPolicy" (
  "installationId" TEXT NOT NULL PRIMARY KEY,
  "documentEmbedding" BOOLEAN NOT NULL DEFAULT false,
  rag BOOLEAN NOT NULL DEFAULT false,
  attachment BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ModelTransferPolicy_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "Installation"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ModelTransferPolicy_primary_check" CHECK ("installationId" = 'primary')
);
