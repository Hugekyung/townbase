# Townbase Phase 6 Chunking

status: planned

## Objective
Implement Phase 6 chunking so persisted documents are split into searchable chunks with stable metadata, using the TASK-defined chunking policy and keeping embedding/vector search deferred to Phase 7.

## Confirmed inputs
- `TASK_v0_1_retrieval_modes.md` Phase 6 defines chunking as the next step after ingestion.
- `PRD_v0_1_retrieval_modes.md` says chunking must preserve `sectionTitle`, `headingPath`, `chunkIndex`, `contentHash`, `sourceType`, `knowledgeTypes`, `domainTags`, `sourcePriority`, and `tokenCount`.
- `packages/rag-core/README.md` already reserves `rag-core` for later chunking / retrieval / scoring logic.
- `packages/database/prisma/schema.prisma` already contains `DocumentChunk` fields needed for Phase 6.
- Phase 5 is merged and already exposes the ingestion seam where chunking can be invoked after document persistence.

## Scope
- In: chunking interfaces, markdown/plain-text chunkers, heading-based chunk splitting with token fallback, chunk overlap policy, metadata propagation, chunk persistence wiring, and regression coverage.
- Out: embedding generation, vector search, retrieval mode strategy, prompt templates, chat response shaping, and any UI work.

## Chosen approach
- Create a pure chunking core in `packages/rag-core` so chunking rules stay separate from API orchestration and persistence.
- Add a small ingestion seam in `apps/api` that calls the chunking core after document upsert and writes `DocumentChunk` records.
- Scaffold `packages/rag-core` as a real workspace package with build/test scripts before adding the chunking implementation.
- Use strategy selection by document shape/sourceType, not by ad hoc branching in the persistence layer.
- Keep the chunking policy deterministic: heading hierarchy first, token fallback second, with TASK-defined chunk size and overlap values.
- Preserve source-grounded metadata on every chunk and mark prior chunks inactive or replace them when a document changes.
- Phase 6 stops at deterministic document splitting plus metadata propagation; higher-complexity chunking families that depend on embeddings, vector search, retrieval-time re-ranking, or adaptive chunk fusion are Phase 7 work and stay out of this phase.

## TODOs
- [x] Scaffold `packages/rag-core` as a real TypeScript package for chunking logic and shared interfaces.
- [x] Implement the chunking core: Markdown-aware chunking, plain-text fallback, heading hierarchy splitting, token fallback, overlap, token counting, and metadata propagation.
- [x] Wire Phase 6 chunk execution into the ingestion pipeline after document persistence and persist `DocumentChunk` rows.
- [x] Add regression coverage for document types that need different chunking behavior and for stale chunk replacement / inactive handling.
- [x] Document the Phase 6 boundary versus Phase 7 embedding / vector search.

## Acceptance criteria
- Markdown and Notion documents are split into chunks using heading hierarchy first.
- Documents that do not have a usable hierarchy still produce chunks via token fallback.
- Chunks persist `sectionTitle`, `headingPath`, `chunkIndex`, `contentHash`, `tokenCount`, `sourceType`, `knowledgeTypes`, `domainTags`, and `sourcePriority`.
- A changed document produces new chunks and retires prior chunks according to the chosen replace/inactive policy.
- Phase 7 embedding / vector search remains out of scope.

## QA Scenarios

### Scenario: markdown document splits into stable chunks
- Tool: `pnpm --filter @townbase/rag-core test -- --runTestsByPath test/chunker.spec.ts`
- Setup: a fixture or in-memory markdown document with headings and body text that should split into multiple chunks.
- Expected: chunk boundaries follow heading hierarchy first, metadata is preserved, and the chunk count is deterministic.
- Evidence: `.omo/evidence/townbase-phase6-chunking-markdown-pass.txt`

### Scenario: plain text fallback chunking works
- Tool: `pnpm --filter @townbase/rag-core test -- --runTestsByPath test/chunker.spec.ts`
- Setup: a document with no usable headings but enough text to require token fallback.
- Expected: fallback chunking still produces valid chunks with token counts and overlap.
- Evidence: `.omo/evidence/townbase-phase6-chunking-fallback-pass.txt`

### Scenario: changed documents retire old chunks
- Tool: `pnpm --filter @townbase/api test -- --runTestsByPath test/app.e2e-spec.ts`
- Setup: a document update that changes persisted content and triggers chunk regeneration.
- Expected: new chunks are persisted and old chunks are retired or marked inactive according to the plan policy.
- Evidence: `.omo/evidence/townbase-phase6-chunking-replace-pass.txt`

## Notes
- Preferred test strategy: TDD.
- The implementation should stay inside Phase 6 boundaries and should not introduce embedding, vector search, or retrieval mode behavior yet.
- Excluded chunking families such as semantic chunking, retrieval-driven chunk fusion, and embedding-informed re-chunking remain deferred to Phase 7.
