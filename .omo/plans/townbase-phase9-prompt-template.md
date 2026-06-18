# Townbase Phase 9 Prompt Template

## TL;DR
> Summary:      Implement deterministic mode-specific prompt templates and response shaping so later chat orchestration can consume a stable answer contract.
> Deliverables: `packages/agent-core` scaffold, shared system prompt, source-grounded answer rule, mode-specific prompts, fallback prompt, response schema, context builder, citation builder, regression coverage
> Effort:       Medium
> Risk:         Medium - new prompt/response contract, but no retrieval or API wiring

## Scope
### Must have
- `packages/agent-core` as the home for prompt-template and response-shaping logic.
- Shared system prompt that enforces source-grounded answers.
- Mode-specific prompt templates for `onboarding`, `product_history`, and `documentation_gap`.
- Fallback prompt for weak or insufficient context.
- LLM response schema with `answer`, `isAnswerable`, `confidence`, `knowledgeGap`, and `suggestedFollowups`.
- Context builder that assembles the prompt input from traced retrieval results.
- Citation builder that formats source references from traced source rows.

### Must NOT have
- No chat API wiring.
- No question embedding or retrieval-selection logic.
- No Knowledge Gap persistence flow.
- No draft generation flow.
- No UI or admin surface.

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: TDD with Jest for prompt selection, response shaping, and citation formatting.
- Evidence: `.omo/evidence/task-<N>-townbase-phase9-prompt-template.txt`

## Execution strategy
### Parallel execution waves
> Target 3-5 todos per wave. Keep the work small and deterministic.
Wave 1 (no deps): scaffold `packages/agent-core` as a real package and define the prompt/response contract types.
Wave 2 (after 1): implement the shared system prompt, source-grounded answer rule, mode-specific prompts, and fallback prompt.
Wave 3 (after 1 and 2): implement the context builder and citation builder using traced source rows.
Wave 4 (after 2 and 3): add regression coverage for mode-specific prompt selection, fallback behavior, and citation formatting.
Critical path: scaffold the package first, then lock the prompt contract, then wire context/citation shaping, then prove behavior with tests.

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1. Scaffold `packages/agent-core` as a real package | None | 2, 3, 4 | None |
| 2. Define the prompt/response contract and shared system prompt | 1 | 3, 4 | None |
| 3. Implement mode-specific prompts and fallback prompt | 2 | 4 | None |
| 4. Add context builder, citation builder, and regression coverage | 1, 2, 3 | Final verification wave | None |

## Todos
> Implementation + Test = ONE todo. Never separate.
- [x] 1. Scaffold `packages/agent-core` as a real TypeScript package for prompt-template logic
  What to do / Must NOT do
  - Turn the existing placeholder package into a buildable package with entrypoint, tsconfig, test setup, and exported prompt/response types.
  - Keep the package focused on prompt/template and response-shaping contracts only.
  - Do not add chat API wiring or retrieval logic here.
  Parallelization: Can parallel N | Wave 1 | Blocks / Blocked by None
  References (executor has NO interview context - be exhaustive): `packages/agent-core/README.md`, `TASK_v0_1_retrieval_modes.md:361-424`, `PRD_v0_1_retrieval_modes.md:156-173`, `PRD_v0_1_retrieval_modes.md:651-695`
  Acceptance criteria (agent-executable): `pnpm --filter @townbase/agent-core test` and `pnpm --filter @townbase/agent-core build` succeed after the package scaffold exists.
  QA scenarios (name the exact tool + invocation): happy: `pnpm --filter @townbase/agent-core test` returns PASS; failure: missing package entrypoint or invalid exports fail the build; Evidence `.omo/evidence/task-1-townbase-phase9-prompt-template.txt`
  Commit: Y | feat(agent-core): scaffold prompt template package | Files: `packages/agent-core/package.json`, `packages/agent-core/tsconfig.json`, `packages/agent-core/src/index.ts`, `packages/agent-core/test/*.spec.ts`

- [x] 2. Define the shared prompt/response contract in `packages/agent-core`
  What to do / Must NOT do
  - Define the shared system prompt, source-grounded answer rule, and explicit response schema.
  - Keep the response schema minimal and inspectable: `answer`, `isAnswerable`, `confidence`, `knowledgeGap`, `suggestedFollowups`.
  - Do not add prompt inference or any retrieval mode decision logic.
  Parallelization: Can parallel N | Wave 2 | Blocks / Blocked by 1
  References (executor has NO interview context - be exhaustive): `TASK_v0_1_retrieval_modes.md:361-389`, `PRD_v0_1_retrieval_modes.md:156-173`, `PRD_v0_1_retrieval_modes.md:651-695`, `packages/rag-core/src/retrieval-mode.ts:1-285`
  Acceptance criteria (agent-executable): unit tests confirm the shared prompt contract and response schema shape are exported and stable.
  QA scenarios (name the exact tool + invocation): happy: `pnpm --filter @townbase/agent-core test -- --runTestsByPath test/prompt-contract.spec.ts` proves the schema and system prompt shape; failure: invalid schema fields are rejected by the contract test; Evidence `.omo/evidence/task-2-townbase-phase9-prompt-template.txt`
  Commit: Y | feat(agent-core): add prompt response contract | Files: `packages/agent-core/src/prompt-contract.ts`, `packages/agent-core/test/prompt-contract.spec.ts`

- [x] 3. Implement mode-specific prompts and fallback prompt in `packages/agent-core`
  What to do / Must NOT do
  - Implement deterministic prompt templates for `onboarding`, `product_history`, `documentation_gap`, and fallback handling.
  - Keep the templates source-grounded and mode-specific; do not introduce chat API orchestration or LLM calls.
  - Preserve Phase 8 retrieval mode outputs as inputs to the prompt layer.
  Parallelization: Can parallel N | Wave 3 | Blocks / Blocked by 2
  References (executor has NO interview context - be exhaustive): `TASK_v0_1_retrieval_modes.md:369-389`, `PRD_v0_1_retrieval_modes.md:158-173`, `PRD_v0_1_retrieval_modes.md:688-695`, `packages/agent-core/README.md`
  Acceptance criteria (agent-executable): tests prove the correct template is chosen per mode and fallback is selected for weak context.
  QA scenarios (name the exact tool + invocation): happy: `pnpm --filter @townbase/agent-core test -- --runTestsByPath test/prompt-templates.spec.ts` returns PASS; failure: a missing or mismatched template is caught by the test; Evidence `.omo/evidence/task-3-townbase-phase9-prompt-template.txt`
  Commit: Y | feat(agent-core): add prompt templates | Files: `packages/agent-core/src/prompt-templates.ts`, `packages/agent-core/test/prompt-templates.spec.ts`

- [x] 4. Implement context builder and citation builder regression coverage
  What to do / Must NOT do
  - Add a context builder that turns traced retrieval results into prompt input without inventing new selection logic.
  - Add a citation builder that formats source references from traced source rows.
  - Add regression coverage for mode-specific prompt selection, fallback handling, and citation formatting.
  Parallelization: Can parallel N | Wave 4 | Blocks / Blocked by 1, 2, 3
  References (executor has NO interview context - be exhaustive): `TASK_v0_1_retrieval_modes.md:390-424`, `PRD_v0_1_retrieval_modes.md:626-642`, `PRD_v0_1_retrieval_modes.md:704-748`, `packages/database/prisma/schema.prisma:183-221`
  Acceptance criteria (agent-executable): context and citation tests prove the prompt layer consumes traced source rows and emits the documented answer contract.
  QA scenarios (name the exact tool + invocation): happy: `pnpm --filter @townbase/agent-core test -- --runTestsByPath test/context-builder.spec.ts test/citation-builder.spec.ts` returns PASS; failure: broken citation formatting or missing source context fails tests; Evidence `.omo/evidence/task-4-townbase-phase9-prompt-template.txt`
  Commit: Y | test(agent-core): cover prompt shaping contracts | Files: `packages/agent-core/test/context-builder.spec.ts`, `packages/agent-core/test/citation-builder.spec.ts`, `packages/agent-core/test/prompt-templates.spec.ts`

## Final verification wave (after ALL todos)
> Runs in parallel. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [x] F1. Plan compliance audit
- [x] F2. Code quality review
- [x] F3. Real manual QA
- [x] F4. Scope fidelity

## Commit strategy
- Commit 1: package scaffold and public contracts.
- Commit 2: shared prompt templates and response schema.
- Commit 3: context/citation shaping and regression coverage.
- Keep each commit atomic and buildable on its own.

## Success criteria
- `packages/agent-core` is a real buildable package.
- Prompt selection is deterministic and mode-specific.
- Response shaping is explicit, source-grounded, and inspectable.
- Citation formatting preserves traced source references.
- Phase 10 chat orchestration remains out of scope.
