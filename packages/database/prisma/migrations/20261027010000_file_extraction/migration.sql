CREATE TABLE "FileOriginal" (
  "id" UUID NOT NULL,
  "installationId" TEXT NOT NULL,
  "ownerAdministratorId" TEXT NOT NULL,
  "title" VARCHAR(255) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FileOriginal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FileOriginal_title_check" CHECK (length(btrim("title")) > 0),
  CONSTRAINT "FileOriginal_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "Installation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FileOriginal_installationId_ownerAdministratorId_fkey" FOREIGN KEY ("installationId", "ownerAdministratorId") REFERENCES "Administrator"("installationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "FileOriginal_installationId_id_key" ON "FileOriginal"("installationId", "id");
CREATE TABLE "FileVersion" (
  "id" UUID NOT NULL,
  "installationId" TEXT NOT NULL,
  "originalId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "fileName" VARCHAR(255) NOT NULL,
  "format" VARCHAR(8) NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "contentHash" VARCHAR(64) NOT NULL,
  "storageKey" VARCHAR(80) NOT NULL,
  "sourceType" "SourceType" NOT NULL DEFAULT 'uploaded_file',
  "knowledgeTypes" "KnowledgeType"[] NOT NULL,
  "domainTags" TEXT[] NOT NULL,
  "documentStatus" "DocumentStatus" NOT NULL DEFAULT 'active',
  "extraction" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FileVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FileVersion_values_check" CHECK ("version" >= 1 AND "byteSize" BETWEEN 1 AND 20971520 AND "format" IN ('pdf','docx','md','txt') AND "sourceType" = 'uploaded_file' AND "contentHash" ~ '^[0-9a-f]{64}$' AND "storageKey" = "id"::text || '.bin' AND length(btrim("fileName")) > 0),
  CONSTRAINT "FileVersion_extraction_check" CHECK ("extraction" IS NULL OR (jsonb_typeof("extraction") = 'object' AND "extraction"->>'format' = "format" AND jsonb_typeof("extraction"->'segments') = 'array' AND ("extraction"->>'codePoints')::integer BETWEEN 1 AND 300000) IS TRUE),
  CONSTRAINT "FileVersion_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "Installation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FileVersion_installationId_originalId_fkey" FOREIGN KEY ("installationId", "originalId") REFERENCES "FileOriginal"("installationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "FileVersion_storageKey_key" ON "FileVersion"("storageKey");
CREATE UNIQUE INDEX "FileVersion_installationId_id_key" ON "FileVersion"("installationId", "id");
CREATE UNIQUE INDEX "FileVersion_installationId_originalId_version_key" ON "FileVersion"("installationId", "originalId", "version");
CREATE TABLE "FileExtractionRun" (
  "id" UUID NOT NULL,
  "installationId" TEXT NOT NULL,
  "versionId" UUID NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "errorCode" VARCHAR(64),
  "startedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FileExtractionRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FileExtractionRun_values_check" CHECK ("completedAt" >= "startedAt" AND (("status" = 'extracted' AND "errorCode" IS NULL) OR ("status" = 'failed' AND "errorCode" IS NOT NULL AND "errorCode" IN ('unsupported_format','file_too_large','invalid_format','invalid_utf8','encrypted_file','no_extractable_text','extraction_limit','archive_limit','unsafe_archive','extraction_timeout','parser_unavailable','parser_failed','parser_busy')))),
  CONSTRAINT "FileExtractionRun_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "Installation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FileExtractionRun_installationId_versionId_fkey" FOREIGN KEY ("installationId", "versionId") REFERENCES "FileVersion"("installationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "FileExtractionRun_installationId_completedAt_idx" ON "FileExtractionRun"("installationId", "completedAt");
