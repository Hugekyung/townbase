# Townbase Phase 7 Embedding & Vector Search

status: completed

## Confirmed facts
- `TASK_v0_1_retrieval_modes.md` Phase 7 is limited to chunk embedding and pgvector similarity search.
- `TASK_v0_1_retrieval_modes.md` explicitly excludes late chunking, semantic chunking, and hierarchical parent-child retrieval from v0.1 MVP.
- `PRD_v0_1_retrieval_modes.md` requires chunk embeddings, `indexStatus=failed` on embedding failure, question embeddings, cosine similarity search, topK search, score threshold config, and workspace scoping.
- `packages/database/prisma/schema.prisma` currently has `DocumentChunk` without an embedding column and already has the document/chunk metadata fields added by prior phases.
- `packages/database/prisma` already targets PostgreSQL with pgvector provisioning from the earlier foundation phase.
- Phase 6 has been completed, so Phase 7 can build on persisted chunks rather than inventing a new document splitting path.

## Decision set
- Phase 7 should implement OpenAI embedding model support first because the TASK names OpenAI embedder explicitly.
- The phase should add the embedding column, embedding generation service, chunk embedding persistence, question embedding generation, and pgvector cosine similarity search.
- The phase should keep retrieval strategy selection, prompt templates, and chat response shaping out of scope.
- The phase should treat `DocumentChunk` embeddings as the search substrate and leave advanced retrieval families for later MVP+ work.

## Scope
- In: embedder interface, OpenAI embedding model integration, embedding model config, `DocumentChunk.embedding` schema/migration, embedding generation service, chunk embedding storage, question embedding generation, cosine similarity search, topK search, score threshold config, workspaceId scoping, and regression coverage.
- Out: retrieval-mode strategy, prompt templates, chat orchestration, semantic chunking, late chunking, hierarchical retrieval, UI work, and any non-OpenAI embedder unless the user changes the decision.

## Approach
- Keep embedding logic isolated in a small shared core so the API and database layers only orchestrate persistence and queries.
- Prefer deterministic, source-grounded similarity search over heuristic retrieval changes in this phase.
- Add regression coverage around embedding persistence and similarity query behavior before or alongside the implementation.

## TODOs
- [x] Define embedder interface and OpenAI embedding model config
- [x] Add `DocumentChunk.embedding` schema and migration
- [x] Implement embedding generation and persistence for chunks and questions
- [x] Implement pgvector cosine similarity search and topK retrieval
- [x] Add regression coverage for embedding failure and workspace-scoped search

## Acceptance criteria
- Chunk embeddings are stored in PostgreSQL.
- Question embeddings can search for related chunks with cosine similarity.
- Embedding failures set `indexStatus=failed`.
- Search results are filtered by `workspaceId`.
- Phase 8 retrieval strategy remains out of scope.

## QA Scenarios

### Scenario: chunk embeddings persist and are searchable
- Tool: `pnpm --filter @townbase/connectors test`
- Setup: a chunked document fixture and a mocked embedding provider or deterministic local embedder.
- Expected: stored chunk rows include embeddings and the similarity query returns the expected topK chunks.
- Evidence: `.omo/evidence/townbase-phase7-embedding-vector-search-embedding-pass.txt`

### Scenario: embedding failure is surfaced
- Tool: `pnpm --filter @townbase/connectors test`
- Setup: an embedding provider failure for one chunk or question.
- Expected: `indexStatus` becomes `failed` and the failure is visible in sync summary or status records.
- Evidence: `.omo/evidence/townbase-phase7-embedding-vector-search-failure-pass.txt`

## Notes
- Preferred test strategy: TDD.
- The implementation should stay inside Phase 7 boundaries and should not introduce retrieval mode behavior yet.
- Late chunking, semantic chunking, and hierarchical parent-child retrieval remain deferred to MVP+ work.
