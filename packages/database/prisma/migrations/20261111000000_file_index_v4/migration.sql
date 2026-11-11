-- R07: v4 chunks (2,048-byte default target, number/date/section periods kept
-- inside units) are opt-in on explicit reindex after reprocessing with
-- extraction d03-v3. Preserve v1-v3 rows; v2/v3 stay readable until replaced.
ALTER TABLE "FileIndex" DROP CONSTRAINT "FileIndex_configurationVersion_check";
ALTER TABLE "FileIndex" ADD CONSTRAINT "FileIndex_configurationVersion_check"
CHECK ("configurationVersion" IN ('file-index-d04-v1','file-index-d04-v2','file-index-d04-v3','file-index-d04-v4'));
