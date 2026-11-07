-- Keep stored Gap references compatible with the reader and RagTurn sources.
-- Existing incompatible rows fail visibly; do not truncate historical evidence.
ALTER TABLE "RagGap" ADD CONSTRAINT "RagGap_sourceRefs_limit_check"
CHECK (CASE WHEN jsonb_typeof("sourceRefs")='array'
  THEN jsonb_array_length("sourceRefs")<=20 ELSE false END);
