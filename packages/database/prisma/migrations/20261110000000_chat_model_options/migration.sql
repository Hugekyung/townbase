-- Existing turns retain NULL: their historical reasoning is unknown, never backfilled.
ALTER TABLE "RagTurn" ADD COLUMN "modelOptions" JSONB;
ALTER TABLE "AttachmentTask" ADD COLUMN "modelOptions" JSONB;
ALTER TABLE "RagTurn" ADD CONSTRAINT "RagTurn_modelOptions_check" CHECK (
 "modelOptions" IS NULL OR CASE WHEN jsonb_typeof("modelOptions") = 'object' THEN
  ("modelOptions" ?& ARRAY['answerModel','reasoning']) AND
  ("modelOptions" - ARRAY['answerModel','reasoning']) = '{}'::jsonb AND
  jsonb_typeof("modelOptions"->'answerModel') = 'string' AND jsonb_typeof("modelOptions"->'reasoning') = 'string' AND
  "modelOptions"->>'answerModel' IN ('gpt-6-luna','gpt-6.1-sol') AND
  "modelOptions"->>'reasoning' IN ('none','low','medium','high','xhigh','max') AND
  NOT ("modelOptions"->>'answerModel'='gpt-6.1-sol' AND "modelOptions"->>'reasoning'='none') AND
  (model IS NULL OR model = "modelOptions"->>'answerModel')
 ELSE false END);
ALTER TABLE "RagTurn" ADD CONSTRAINT "RagTurn_modelOptions_configured_check" CHECK ("modelOptions" IS NULL OR "configuredModel" = "modelOptions"->>'answerModel');
ALTER TABLE "AttachmentTask" ADD CONSTRAINT "AttachmentTask_modelOptions_check" CHECK (
 "modelOptions" IS NULL OR CASE WHEN jsonb_typeof("modelOptions") = 'object' THEN
  ("modelOptions" ?& ARRAY['answerModel','reasoning']) AND
  ("modelOptions" - ARRAY['answerModel','reasoning']) = '{}'::jsonb AND
  jsonb_typeof("modelOptions"->'answerModel') = 'string' AND jsonb_typeof("modelOptions"->'reasoning') = 'string' AND
  "modelOptions"->>'answerModel' IN ('gpt-6-luna','gpt-6.1-sol') AND
  "modelOptions"->>'reasoning' IN ('none','low','medium','high','xhigh','max') AND
  NOT ("modelOptions"->>'answerModel'='gpt-6.1-sol' AND "modelOptions"->>'reasoning'='none') AND
  (model IS NULL OR model = "modelOptions"->>'answerModel')
 ELSE false END);
-- No new UPDATE privilege: choices are immutable admission metadata.
