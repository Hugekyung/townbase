# Townbase Phase 9 Prompt Template

status: approved

## Confirmed facts
- `TASK_v0_1_retrieval_modes.md` Phase 9 is `Prompt Template 구현`.
- The task requires a shared system prompt, source-grounded answer rule, mode-specific prompts for `onboarding`, `product_history`, and `documentation_gap`, a fallback prompt, an LLM response schema, a context builder, and a citation builder.
- `PRD_v0_1_retrieval_modes.md` requires mode-specific answer formatting, source-grounded responses, confidence, `isAnswerable`, and Knowledge Gap handoff signals.
- `packages/agent-core` currently only has a README placeholder and is the natural home for prompt/orchestration/response-shaping code in later phases.
- Phase 8 is already completed; Phase 9 should not change retrieval-mode selection logic or add chat API orchestration.

## Decision set
- Phase 9 should scaffold `packages/agent-core` as the owner of prompt template and response-shaping logic.
- The phase should keep prompt generation deterministic and mode-specific, with a shared source-grounded system prompt and a fallback path for weak/insufficient context.
- The response schema should stay explicit and minimal: `answer`, `isAnswerable`, `confidence`, `knowledgeGap`, and `suggestedFollowups`.
- Citation building should consume traced source records rather than inventing new retrieval behavior.

## Scope
- In: shared system prompt, source-grounded answer rule, mode-specific prompts, fallback prompt, response schema, context builder, citation builder, and `packages/agent-core` scaffolding/tests.
- Out: chat API wiring, question embedding, retrieval strategy selection, Knowledge Gap persistence, draft generation, and UI.

## Test strategy
- TDD.
- Unit tests for prompt selection, response-schema shaping, and citation formatting first.
- Regression coverage for mode-specific prompt selection and fallback handling.

## Approach
- Keep the prompt layer purely deterministic and inspectable.
- Reuse retrieval-mode outputs from Phase 8 rather than duplicating mode inference.
- Make the response schema and citation builder small enough for later chat orchestration to consume without re-deciding behavior.

## Pending action
- write `.omo/plans/townbase-phase9-prompt-template.md`
