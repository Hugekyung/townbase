WITH draft_ranks AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "workspaceId", "knowledgeGapId", "type"
      ORDER BY "updatedAt" DESC, "createdAt" DESC, "id" DESC
    ) AS "rowNumber"
  FROM "ActionDraft"
)
DELETE FROM "ActionDraft"
WHERE "id" IN (
  SELECT "id"
  FROM draft_ranks
  WHERE "rowNumber" > 1
);

DROP INDEX IF EXISTS "ActionDraft_workspaceId_knowledgeGapId_type_idx";

CREATE UNIQUE INDEX "ActionDraft_workspaceId_knowledgeGapId_type_key"
ON "ActionDraft"("workspaceId", "knowledgeGapId", "type");
