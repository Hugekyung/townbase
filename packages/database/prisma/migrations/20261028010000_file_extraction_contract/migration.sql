-- Keep previously applied migrations unchanged. Tighten the persisted JSON envelope;
-- segment text/locations/count consistency is also checked before returning stored results.
ALTER TABLE "FileVersion" DROP CONSTRAINT "FileVersion_extraction_check";
ALTER TABLE "FileVersion" ADD CONSTRAINT "FileVersion_extraction_check" CHECK (
  "extraction" IS NULL OR (
    CASE WHEN jsonb_typeof("extraction") = 'object'
      AND jsonb_typeof("extraction"->'codePoints') = 'number'
      AND jsonb_typeof("extraction"->'segments') = 'array'
    THEN "extraction"->>'format' = "format"
      AND ("extraction"->>'codePoints')::numeric BETWEEN 1 AND 300000
      AND trunc(("extraction"->>'codePoints')::numeric) = ("extraction"->>'codePoints')::numeric
      AND jsonb_array_length("extraction"->'segments') BETWEEN 1 AND 300000
    ELSE false END
  ) IS TRUE
);
CREATE INDEX "FileExtractionRun_installationId_versionId_completedAt_idx"
  ON "FileExtractionRun"("installationId", "versionId", "completedAt");
