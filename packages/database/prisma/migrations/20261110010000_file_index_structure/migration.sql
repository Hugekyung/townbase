-- Structure-preserving chunks are opt-in on explicit reindex. Preserve v1/v2
-- rows and let the application keep readable v2 indexes until replacement.
ALTER TABLE "FileIndex" DROP CONSTRAINT "FileIndex_configurationVersion_check";
ALTER TABLE "FileIndex" ADD CONSTRAINT "FileIndex_configurationVersion_check"
CHECK ("configurationVersion" IN ('file-index-d04-v1','file-index-d04-v2','file-index-d04-v3'));
