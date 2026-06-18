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
- Phase 7 should implement OpenAI-based chunk embedding first because the TASK names OpenAI embedder explicitly.
- The phase should add the embedding column, embedding generation service, chunk embedding persistence, question embedding generation, and pgvector cosine similarity search.
- The phase should keep retrieval strategy selection, prompt templates, and chat response shaping out of scope.
- The phase should treat `DocumentChunk` embeddings as the search substrate and leave advanced retrieval families for later MVP+ work.

## Scope
- In: embedder interface, OpenAI embedder, embedding model config, `DocumentChunk.embedding` schema/migration, embedding generation service, chunk embedding storage, question embedding generation, cosine similarity search, topK search, score threshold config, workspaceId scoping, and regression coverage.
- Out: retrieval-mode strategy, prompt templates, chat orchestration, semantic chunking, late chunking, hierarchical retrieval, UI work, and any non-OpenAI embedder unless the user changes the decision.

## Approach
- Keep embedding logic isolated in a small shared core so the API and database layers only orchestrate persistence and queries.
- Prefer deterministic, source-grounded similarity search over heuristic retrieval changes in this phase.
- Add regression coverage around embedding persistence and similarity query behavior before or alongside the implementation.

## Pending action
- none
