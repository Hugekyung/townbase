-- Historical runs do not identify their captured scope. Keep NULL rather than
-- guessing the current revision; read paths must fail closed for such sources.
ALTER TABLE "FileRun" ADD COLUMN "sourceScopeRevision" INTEGER
 CHECK ("sourceScopeRevision" IS NULL OR "sourceScopeRevision">0);
