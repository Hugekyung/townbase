# Townbase Phase 4 Local Repository Connector

status: completed

## Objective
Implement local repository ingestion for `TASK_v0_1_retrieval_modes.md` Phase 4 so the system can read document-like files from selected local repositories, classify them with the shared metadata rules, and persist them as Documents.

## Scope decision
- Sync only repositories explicitly selected by the user.
- `REPO_ROOT_PATH=./repos` is the local mount root that contains candidate repositories.
- No remote discovery or network-backed repository fetching.
- No automatic crawl of the entire machine filesystem.
- The baseline implementation should support syncing one or more named repos from the mounted set, not indiscriminate scanning of every repo under the root.

## Confirmed inputs
- The Phase 4 task already defines the include and exclude glob rules.
- The PRD already defines repository-path classification examples and expected sourceType/knowledgeTypes mappings.
- Phase 3 is Notion-only, so Phase 4 can reuse the shared metadata classifier without changing Notion ingestion semantics.

## Plan
1. Add a local repository scanner rooted at `REPO_ROOT_PATH`.
2. Limit discovery to the user-selected repository or repositories.
3. Apply the include and exclude globs from the task document.
4. Read file content and capture `repoName`, `filePath`, and modified time.
5. Map each file into a Document record.
6. Reuse the shared classifier so repo paths resolve to the PRD-defined metadata contract.
7. Implement incremental sync so unchanged files are skipped.
8. Add regression coverage for selection scope, path filtering, and metadata mapping.

## Out of scope
- Whole-machine file discovery.
- Automatic repository inventory across unrelated local folders.
- Retrieval mode logic changes.
- Prompt or answer-generation changes.
- Queue, worker, or cloud deployment additions.

## Completion criteria
- A selected local repository can be scanned and synced into Document records.
- Only allowed document-like files are ingested.
- Excluded files and sensitive/build artifacts are skipped.
- Repository metadata and classifier output are persisted consistently.
- Sync behavior is incremental for unchanged files.

## Open implementation detail
- Expose repo selection by config, CLI, or sync API first. The implementation should keep the selection primitive explicit, not implicit.
