-- Commit the enum addition before the following migration uses it as a default.
ALTER TYPE "SourceType" ADD VALUE 'uploaded_file';
