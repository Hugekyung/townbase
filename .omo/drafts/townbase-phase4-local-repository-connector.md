# Townbase Phase 4 Local Repository Connector

status: prepared

## Confirmed inputs
- `TASK_v0_1_retrieval_modes.md` Phase 4 is the local repository connector phase.
- The task explicitly sets `REPO_ROOT_PATH=./repos`.
- The include/exclude glob set is already fixed in the task document.
- `PRD_v0_1_retrieval_modes.md` defines the repository file classification examples that Phase 4 must follow.
- Phase 3 is Notion-only ingestion and does not define local repository scanning, so there is no direct behavioral conflict.

## Scope decision
- Default ingestion scope: only repositories explicitly selected by the user for sync.
- `REPO_ROOT_PATH=./repos` is the local mount root that contains candidate repositories.
- No remote discovery or network-backed repository fetching.
- No automatic crawl of the entire machine filesystem.
- The implementation should support syncing one or more named repos from the mounted set, rather than scanning every repository indiscriminately.

## Chosen approach
- Build a repository directory scanner rooted at `REPO_ROOT_PATH`.
- Walk only the document-like include patterns from the task file.
- Apply the exclude patterns before content reads.
- Preserve `repoName`, `filePath`, and `modifiedAt` on the resulting Document records.
- Reuse the shared metadata classifier introduced in Phase 2 so repo file paths map to the same sourceType and knowledgeTypes contract.
- Make sync incremental by comparing file modified time and content fingerprint or equivalent change marker.

## Out of scope
- Whole-machine file discovery.
- Non-document source expansion.
- Vectorization, retrieval mode changes, prompt changes, or chat response changes.
- User-facing repo selection UX unless the task doc is later updated.

## Open implementation detail
- Repo selection should be exposed through config, CLI, or sync API first. The scope itself is fixed to selected repos only.
