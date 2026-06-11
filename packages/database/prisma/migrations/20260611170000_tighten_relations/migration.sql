ALTER TABLE "ActionDraft" DROP CONSTRAINT "ActionDraft_knowledgeGapId_fkey";

ALTER TABLE "Document" DROP CONSTRAINT "Document_dataSourceId_fkey";

ALTER TABLE "DocumentChunk" DROP CONSTRAINT "DocumentChunk_documentId_fkey";

ALTER TABLE "KnowledgeGap" DROP CONSTRAINT "KnowledgeGap_questionId_fkey";

ALTER TABLE "QuestionSource" DROP CONSTRAINT "QuestionSource_chunkId_fkey";

ALTER TABLE "QuestionSource" DROP CONSTRAINT "QuestionSource_questionId_fkey";

DROP INDEX "QuestionSource_questionId_chunkId_mode_key";

ALTER TABLE "QuestionSource" ADD COLUMN     "workspaceId" TEXT NOT NULL;

CREATE INDEX "ActionDraft_workspaceId_idx" ON "ActionDraft"("workspaceId");

CREATE INDEX "ActionDraft_knowledgeGapId_idx" ON "ActionDraft"("knowledgeGapId");

CREATE INDEX "DataSource_workspaceId_idx" ON "DataSource"("workspaceId");

CREATE UNIQUE INDEX "DataSource_workspaceId_id_key" ON "DataSource"("workspaceId", "id");

CREATE INDEX "Document_workspaceId_idx" ON "Document"("workspaceId");

CREATE INDEX "Document_dataSourceId_idx" ON "Document"("dataSourceId");

CREATE UNIQUE INDEX "Document_workspaceId_id_key" ON "Document"("workspaceId", "id");

CREATE INDEX "DocumentChunk_workspaceId_idx" ON "DocumentChunk"("workspaceId");

CREATE INDEX "DocumentChunk_documentId_idx" ON "DocumentChunk"("documentId");

CREATE UNIQUE INDEX "DocumentChunk_workspaceId_id_key" ON "DocumentChunk"("workspaceId", "id");

CREATE INDEX "KnowledgeGap_workspaceId_idx" ON "KnowledgeGap"("workspaceId");

CREATE INDEX "KnowledgeGap_questionId_idx" ON "KnowledgeGap"("questionId");

CREATE UNIQUE INDEX "KnowledgeGap_workspaceId_questionId_key" ON "KnowledgeGap"("workspaceId", "questionId");

CREATE UNIQUE INDEX "KnowledgeGap_workspaceId_id_key" ON "KnowledgeGap"("workspaceId", "id");

CREATE INDEX "Question_workspaceId_idx" ON "Question"("workspaceId");

CREATE UNIQUE INDEX "Question_workspaceId_id_key" ON "Question"("workspaceId", "id");

CREATE INDEX "QuestionSource_workspaceId_idx" ON "QuestionSource"("workspaceId");

CREATE INDEX "QuestionSource_chunkId_idx" ON "QuestionSource"("chunkId");

CREATE UNIQUE INDEX "QuestionSource_workspaceId_questionId_chunkId_mode_key" ON "QuestionSource"("workspaceId", "questionId", "chunkId", "mode");

ALTER TABLE "Document" ADD CONSTRAINT "Document_workspaceId_dataSourceId_fkey" FOREIGN KEY ("workspaceId", "dataSourceId") REFERENCES "DataSource"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DocumentChunk" ADD CONSTRAINT "DocumentChunk_workspaceId_documentId_fkey" FOREIGN KEY ("workspaceId", "documentId") REFERENCES "Document"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuestionSource" ADD CONSTRAINT "QuestionSource_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuestionSource" ADD CONSTRAINT "QuestionSource_workspaceId_questionId_fkey" FOREIGN KEY ("workspaceId", "questionId") REFERENCES "Question"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuestionSource" ADD CONSTRAINT "QuestionSource_workspaceId_chunkId_fkey" FOREIGN KEY ("workspaceId", "chunkId") REFERENCES "DocumentChunk"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KnowledgeGap" ADD CONSTRAINT "KnowledgeGap_workspaceId_questionId_fkey" FOREIGN KEY ("workspaceId", "questionId") REFERENCES "Question"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ActionDraft" ADD CONSTRAINT "ActionDraft_workspaceId_knowledgeGapId_fkey" FOREIGN KEY ("workspaceId", "knowledgeGapId") REFERENCES "KnowledgeGap"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
