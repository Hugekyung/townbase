# Townbase Phase 11 Knowledge Gap

## TL;DR
> Summary:      Implement Knowledge Gap persistence and query/status surfaces so unanswered or under-supported questions become first-class workspace artifacts exposed through both HTTP and MCP.
> Deliverables: gap generation rules, KnowledgeGap persistence helper, API list/status surfaces, MCP knowledge-gap tool, regression coverage
> Effort:       Large
> Risk:         High - new persistence/workflow surface, cross-package wiring, and state transitions

## Scope
### Must have
- Deterministic gap creation rules for low-confidence or not-answerable questions.
- Gap derivation fields: `category`, `title`, `suggestedDocumentTitle`, `suggestedMarkdownPath`, `suggestedGithubIssueTitle`, `priority`, `relatedMode`, `similarQuestionCount`.
- Knowledge Gap persistence helpers in `packages/database`.
- HTTP API for listing gaps and updating gap status.
- MCP knowledge-gap query/status surface aligned with the HTTP contract.
- Repeat-bad-feedback linkage into gap candidacy using the existing question / source traceability contract; do not introduce a separate feedback persistence model in this phase.
- Regression coverage for creation, listing, status updates, and MCP discovery.

### Must NOT have
- No draft generation implementation.
- No HTTP/web chat surface changes beyond gap signal wiring.
- No retrieval-mode changes, prompt-template redesign, or embedding/vector-search refactors.
- No external issue or document creation.

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: TDD with Jest for derivation rules, persistence helpers, route handlers, and MCP tool behavior.
- QA policy: every todo has agent-executed scenarios.
- Evidence: `.omo/evidence/task-<N>-townbase-phase11-knowledge-gap.txt`

## Execution strategy
### Parallel execution waves
> Target 3-5 todos per wave. Keep the work small and deterministic.
Wave 1 (no deps): scaffold the knowledge-gap persistence helpers and shared derivation contracts.
Wave 2 (after 1): implement gap creation rules, category/title/path derivation, and repeat-feedback linkage.
Wave 3 (after 1, 2): implement HTTP list/status surfaces and wire persistence through the API.
Wave 4 (after 1, 2, 3): add MCP knowledge-gap query/status surface and regression coverage.
Critical path: define the gap contract first, then persist derived records, then expose them through HTTP and MCP, then prove the behavior with tests and one live client scenario.

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1. Scaffold the Knowledge Gap persistence helper and shared derivation contract | None | 2, 3, 4 | None |
| 2. Implement gap creation rules and derived field calculation | 1 | 3, 4 | None |
| 3. Implement HTTP list/status surfaces and persistence wiring | 1, 2 | 4 | None |
| 4. Add MCP knowledge-gap query/status tool and regression coverage | 1, 2, 3 | Final verification wave | None |

## Todos
> Implementation + Test = ONE todo. Never separate.
- [x] 1. Scaffold `packages/database/src/knowledge-gap.ts` as the shared persistence/helper surface
  What to do / Must NOT do
  - Add a dedicated helper module for knowledge-gap queries and mutations that can be reused by HTTP and MCP surfaces.
  - Keep the helper contract source-grounded and aligned with the existing Prisma schema.
  - Do not add draft generation or external issue creation here.
  Parallelization: Can parallel N | Wave 1 | Blocks / Blocked by None
  References (executor has NO interview context - be exhaustive): `TASK_v0_1_retrieval_modes.md:434-465`, `PRD_v0_1_retrieval_modes.md:647-720`, `packages/database/prisma/schema.prisma:221-249`, `packages/database/src/retrieval-mode.ts`
  Acceptance criteria (agent-executable): helper tests prove gap records can be derived and queried without touching draft generation.
  QA scenarios (name the exact tool + invocation): happy: `pnpm --filter @townbase/database test -- --runTestsByPath test/knowledge-gap.spec.ts` returns PASS; failure: helper rejects malformed derived fields or invalid status transitions; Evidence `.omo/evidence/task-1-townbase-phase11-knowledge-gap.txt`
  Commit: Y | feat(database): add knowledge gap helpers | Files: `packages/database/src/knowledge-gap.ts`, `packages/database/test/knowledge-gap.spec.ts`

- [x] 2. Implement gap creation rules and derived field calculation
  What to do / Must NOT do
  - Define the gap creation conditions from retrieval score, `isAnswerable`, missing core information, and repeat bad feedback.
  - Derive `category`, `title`, suggested document/path/issue titles, `priority`, `relatedMode`, and initial `similarQuestionCount`.
  - Keep the derivation deterministic and rule-based.
  Parallelization: Can parallel N | Wave 2 | Blocks / Blocked by 1
  References (executor has NO interview context - be exhaustive): `TASK_v0_1_retrieval_modes.md:442-452`, `TASK_v0_1_retrieval_modes.md:559-589`, `PRD_v0_1_retrieval_modes.md:270-274`, `PRD_v0_1_retrieval_modes.md:694-719`, `apps/api/src/chat/chat.service.ts`
  Acceptance criteria (agent-executable): tests prove gap candidacy is derived consistently from the documented triggers and produces stable output fields.
  QA scenarios (name the exact tool + invocation): happy: `pnpm --filter @townbase/api test -- --runTestsByPath test/chat-service.spec.ts test/knowledge-gap-rules.spec.ts` returns PASS; failure: low-confidence or non-answerable inputs do not produce a gap candidate when the documented rules do not hold; Evidence `.omo/evidence/task-2-townbase-phase11-knowledge-gap.txt`
  Commit: Y | feat(api): derive knowledge gap candidates | Files: `apps/api/src/chat/*.ts`, `apps/api/test/knowledge-gap-rules.spec.ts`, `apps/api/test/chat-service.spec.ts`

- [x] 3. Implement HTTP knowledge-gap list and status surfaces
  What to do / Must NOT do
  - Add a dedicated `knowledge-gaps` API surface under `apps/api`.
  - Implement list filters for `mode`, `category`, and `status`.
  - Implement status update behavior through `PATCH /knowledge-gaps/:id/status`.
  - Reuse the shared persistence helper instead of duplicating query logic.
  Parallelization: Can parallel N | Wave 3 | Blocks / Blocked by 1, 2
  References (executor has NO interview context - be exhaustive): `TASK_v0_1_retrieval_modes.md:453-465`, `PRD_v0_1_retrieval_modes.md:651-654`, `PRD_v0_1_retrieval_modes.md:715-719`, `apps/api/src/chat/chat.registry.ts`, `packages/database/prisma/schema.prisma:221-249`
  Acceptance criteria (agent-executable): API tests prove gaps can be listed and status can be updated through the documented HTTP contract.
  QA scenarios (name the exact tool + invocation): happy: `pnpm --filter @townbase/api test -- --runTestsByPath test/knowledge-gaps.spec.ts` returns PASS; failure: invalid status transitions or unsupported filters are rejected deterministically; Evidence `.omo/evidence/task-3-townbase-phase11-knowledge-gap.txt`
  Commit: Y | feat(api): add knowledge gap surfaces | Files: `apps/api/src/knowledge-gaps/**/*.ts`, `apps/api/test/knowledge-gaps.spec.ts`

- [x] 4. Add MCP knowledge-gap query/status tool and regression coverage
  What to do / Must NOT do
  - Extend the existing MCP knowledge-gap surface so the client can query and update gap status without leaving the MCP path.
  - Keep the MCP contract aligned with the HTTP list/status response fields.
  - Add regression coverage for tool discovery, query behavior, and status updates.
  Parallelization: Can parallel N | Wave 4 | Blocks / Blocked by 1, 2, 3
  References (executor has NO interview context - be exhaustive): `TASK_v0_1_retrieval_modes.md:457-465`, `PRD_v0_1_retrieval_modes.md:717-719`, `apps/api/src/chat/chat.constants.ts`, `apps/api/src/chat/chat.registry.ts`
  Acceptance criteria (agent-executable): MCP tests prove the gap tool is discoverable and returns the documented contract for query/status operations.
  QA scenarios (name the exact tool + invocation): happy: `pnpm --filter @townbase/api test -- --runTestsByPath test/mcp-gaps.spec.ts` returns PASS; failure: unsupported tool calls or malformed query/status payloads fail deterministically; Evidence `.omo/evidence/task-4-townbase-phase11-knowledge-gap.txt`
  Commit: Y | feat(api): add mcp knowledge gap tool | Files: `apps/api/src/chat/*.ts`, `apps/api/test/mcp-gaps.spec.ts`

## Final verification wave (after ALL todos)
> Runs in parallel. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [x] F1. Plan compliance audit
- [x] F2. Code quality review
- [x] F3. Real HTTP/MCP gap client QA
- [x] F4. Scope fidelity

## Commit strategy
- Commit 1: database knowledge-gap helpers and derivation contract.
- Commit 2: gap candidate derivation and repeat-feedback linkage.
- Commit 3: HTTP list/status surfaces and persistence wiring.
- Commit 4: MCP knowledge-gap query/status tool and regression coverage.
- Keep each commit atomic and buildable on its own.

## Success criteria
- Low-confidence or insufficient questions can be promoted to Knowledge Gap records.
- Knowledge Gap records expose category, title, priority, related mode, and suggested follow-up metadata.
- Gap list/status flows are available through both HTTP and MCP.
- Repeat bad feedback can feed gap candidacy.
- Draft generation remains a later phase, not part of Phase 11.
