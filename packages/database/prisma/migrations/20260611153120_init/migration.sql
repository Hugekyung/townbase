CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "DataSourceType" AS ENUM ('notion', 'local_repo');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('notion_page', 'repo_readme', 'repo_docs', 'adr', 'prd', 'schema', 'migration', 'issue_template', 'pr_template', 'incident_review', 'github_issue', 'github_pr', 'slack_thread');

-- CreateEnum
CREATE TYPE "KnowledgeType" AS ENUM ('onboarding', 'product_history', 'architecture', 'domain_policy', 'database', 'deployment', 'incident', 'code_convention', 'testing', 'operation', 'documentation_gap', 'unknown');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('active', 'draft', 'deprecated', 'archived');

-- CreateEnum
CREATE TYPE "RetrievalMode" AS ENUM ('auto', 'onboarding', 'product_history', 'documentation_gap', 'change_impact');

-- CreateEnum
CREATE TYPE "GapPriority" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "GapStatus" AS ENUM ('open', 'drafted', 'resolved', 'ignored');

-- CreateEnum
CREATE TYPE "ActionDraftType" AS ENUM ('github_issue', 'markdown_doc', 'notion_page');

-- CreateEnum
CREATE TYPE "ActionDraftStatus" AS ENUM ('draft', 'copied', 'discarded');

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSource" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "type" "DataSourceType" NOT NULL,
    "name" TEXT NOT NULL,
    "rootPath" TEXT,
    "rootPageId" TEXT,
    "config" JSONB,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "sourceType" "SourceType" NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "filePath" TEXT,
    "repoName" TEXT,
    "content" TEXT NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'active',
    "knowledgeTypes" "KnowledgeType"[],
    "domainTags" TEXT[],
    "externalCreatedAt" TIMESTAMP(3),
    "externalUpdatedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentChunk" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sourceType" "SourceType" NOT NULL,
    "chunkType" TEXT NOT NULL,
    "knowledgeTypes" "KnowledgeType"[],
    "domainTags" TEXT[],
    "sourcePriority" INTEGER NOT NULL,
    "tokenCount" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "requestedMode" "RetrievalMode" NOT NULL DEFAULT 'auto',
    "resolvedMode" "RetrievalMode",
    "confidence" DOUBLE PRECISION,
    "isAnswerable" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionSource" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "rank" INTEGER NOT NULL,
    "mode" "RetrievalMode" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeGap" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "suggestedDocumentTitle" TEXT NOT NULL,
    "suggestedMarkdownPath" TEXT NOT NULL,
    "suggestedGithubIssueTitle" TEXT NOT NULL,
    "priority" "GapPriority" NOT NULL DEFAULT 'medium',
    "status" "GapStatus" NOT NULL DEFAULT 'open',
    "similarQuestionCount" INTEGER NOT NULL DEFAULT 0,
    "relatedMode" "RetrievalMode" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeGap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionDraft" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "knowledgeGapId" TEXT NOT NULL,
    "type" "ActionDraftType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "ActionDraftStatus" NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActionDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_name_key" ON "Workspace"("name");

-- CreateIndex
CREATE INDEX "DataSource_workspaceId_type_idx" ON "DataSource"("workspaceId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "DataSource_workspaceId_name_key" ON "DataSource"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "Document_workspaceId_sourceType_idx" ON "Document"("workspaceId", "sourceType");

-- CreateIndex
CREATE INDEX "Document_workspaceId_status_idx" ON "Document"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Document_dataSourceId_externalId_key" ON "Document"("dataSourceId", "externalId");

-- CreateIndex
CREATE INDEX "DocumentChunk_workspaceId_documentId_idx" ON "DocumentChunk"("workspaceId", "documentId");

-- CreateIndex
CREATE INDEX "Question_workspaceId_requestedMode_idx" ON "Question"("workspaceId", "requestedMode");

-- CreateIndex
CREATE INDEX "QuestionSource_questionId_mode_idx" ON "QuestionSource"("questionId", "mode");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionSource_questionId_chunkId_mode_key" ON "QuestionSource"("questionId", "chunkId", "mode");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeGap_questionId_key" ON "KnowledgeGap"("questionId");

-- CreateIndex
CREATE INDEX "KnowledgeGap_workspaceId_category_idx" ON "KnowledgeGap"("workspaceId", "category");

-- CreateIndex
CREATE INDEX "KnowledgeGap_workspaceId_relatedMode_status_idx" ON "KnowledgeGap"("workspaceId", "relatedMode", "status");

-- CreateIndex
CREATE INDEX "ActionDraft_workspaceId_knowledgeGapId_type_idx" ON "ActionDraft"("workspaceId", "knowledgeGapId", "type");

-- AddForeignKey
ALTER TABLE "DataSource" ADD CONSTRAINT "DataSource_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentChunk" ADD CONSTRAINT "DocumentChunk_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentChunk" ADD CONSTRAINT "DocumentChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionSource" ADD CONSTRAINT "QuestionSource_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionSource" ADD CONSTRAINT "QuestionSource_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "DocumentChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeGap" ADD CONSTRAINT "KnowledgeGap_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeGap" ADD CONSTRAINT "KnowledgeGap_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionDraft" ADD CONSTRAINT "ActionDraft_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionDraft" ADD CONSTRAINT "ActionDraft_knowledgeGapId_fkey" FOREIGN KEY ("knowledgeGapId") REFERENCES "KnowledgeGap"("id") ON DELETE CASCADE ON UPDATE CASCADE;
