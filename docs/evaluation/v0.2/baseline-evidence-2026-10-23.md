# A04 실행 증거 발췌 — 2026-10-23

기존 코드 `0edd5dc`, 문서 변경 상태에서 실행. 원본 로그는 `/tmp/townbase-v02-baseline/`에 있으며 아래 핵심 stdout/exit code를 저장해 임시 로그가 없어져도 결과를 확인한다. 원본 로그 전체나 비밀값을 저장하지 않는다.

## api-build

명령: `pnpm build` / exit `0` / 2.12초

```text
> townbase@0.1.0 build /Users/yanghaechan/prd/workspace-knowledge-agent
> pnpm --filter @townbase/api build
> @townbase/api@0.1.0 build /Users/yanghaechan/prd/workspace-knowledge-agent/apps/api
> tsc -p tsconfig.build.json
```

## api-lint

명령: `pnpm lint` / exit `0` / 2.45초

```text
> townbase@0.1.0 lint /Users/yanghaechan/prd/workspace-knowledge-agent
> pnpm --filter @townbase/api lint
> @townbase/api@0.1.0 lint /Users/yanghaechan/prd/workspace-knowledge-agent/apps/api
> eslint "src/**/*.ts" "test/**/*.ts"
```

## api-tests

명령: `pnpm test` / exit `1` / 5.57초

```text
PASS test/chat-service.spec.ts
FAIL test/drafts.spec.ts
PASS test/chat.spec.ts
PASS test/mcp-drafts.spec.ts
FAIL test/app.e2e-spec.ts
PASS test/chat-runtime.spec.ts
FAIL test/knowledge-gaps.spec.ts
PASS test/mcp-gaps.spec.ts
PASS test/draft-generator.spec.ts
PASS test/knowledge-gaps.service.spec.ts
PASS test/ingestion.service.spec.ts
PASS test/knowledge-gap-rules.spec.ts
PASS test/chat-contract.spec.ts
PASS test/chat-mode.spec.ts
PASS test/connector-runner.spec.ts
PASS test/chat-observability.spec.ts
PASS test/chat-entrypoint.spec.ts
PASS test/port.spec.ts
Test Suites: 3 failed, 15 passed, 18 total
Tests:       12 failed, 41 passed, 53 total
listen EPERM: operation not permitted 0.0.0.0
TypeError: Cannot read properties of null (reading port)
```

## agent-build

명령: `pnpm --filter @townbase/agent-core build` / exit `0` / 1.05초

```text
> @townbase/agent-core@0.1.0 build /Users/yanghaechan/prd/workspace-knowledge-agent/packages/agent-core
> tsc -p tsconfig.json
```

## rag-build

명령: `pnpm --filter @townbase/rag-core build` / exit `0` / 0.89초

```text
> @townbase/rag-core@0.1.0 build /Users/yanghaechan/prd/workspace-knowledge-agent/packages/rag-core
> tsc -p tsconfig.json
```

## connectors-build

명령: `pnpm connectors:build` / exit `0` / 1.15초

```text
> townbase@0.1.0 connectors:build /Users/yanghaechan/prd/workspace-knowledge-agent
> pnpm --filter @townbase/connectors build
> @townbase/connectors@0.1.0 build /Users/yanghaechan/prd/workspace-knowledge-agent/packages/connectors
> tsc -p tsconfig.json
```

## agent-tests

명령: `pnpm --filter @townbase/agent-core test` / exit `0` / 1.42초

```text
PASS test/citation-builder.spec.ts
PASS test/prompt-templates.spec.ts
PASS test/context-builder.spec.ts
PASS test/prompt-contract.spec.ts
PASS test/package-info.spec.ts
Test Suites: 5 passed, 5 total
Tests:       15 passed, 15 total
Time:        0.549 s
```

## rag-tests

명령: `pnpm --filter @townbase/rag-core test` / exit `0` / 1.15초

```text
PASS test/chunker.spec.ts
PASS test/embedding.spec.ts
PASS test/retrieval-mode.spec.ts
PASS test/contracts.spec.ts
PASS test/markdown.spec.ts
PASS test/package-info.spec.ts
Test Suites: 6 passed, 6 total
Tests:       23 passed, 23 total
Time:        0.614 s
```

## database-unit

명령: `pnpm --filter @townbase/database test --testPathIgnorePatterns=database.integration.spec.ts` / exit `0` / 1.31초

```text
PASS test/knowledge-gap.spec.ts
PASS test/action-draft.spec.ts
PASS test/embedding.spec.ts
PASS test/retrieval-mode.spec.ts
Test Suites: 4 passed, 4 total
Tests:       12 passed, 12 total
Time:        0.627 s
```

## connectors-unit

명령: `pnpm --filter @townbase/connectors test --testPathIgnorePatterns=db.integration.spec.ts` / exit `0` / 2.03초

```text
PASS test/notion-sync.spec.ts
PASS test/embedding.spec.ts
PASS test/local-repo-sync.spec.ts
PASS test/local-repo-scan.spec.ts
PASS test/notion-tree.spec.ts
PASS test/local-repo-entrypoint.spec.ts
PASS test/document-chunks.spec.ts
PASS test/classifier.spec.ts
PASS test/notion-root-database.spec.ts
PASS test/notion-mapper.spec.ts
PASS test/env.spec.ts
PASS test/embedding-model.spec.ts
PASS test/local-repo-prisma-store.spec.ts
PASS test/notion-prisma-store.spec.ts
PASS test/retrieval-mode.spec.ts
PASS test/notion-root-errors.spec.ts
PASS test/live-page.spec.ts
PASS test/sync-cli.spec.ts
PASS test/notion-root-page.spec.ts
PASS test/notion-live-sync.spec.ts
PASS test/notion-live-page.spec.ts
PASS test/database-runtime.spec.ts
PASS test/notion-root.spec.ts
Test Suites: 23 passed, 23 total
Tests:       69 passed, 69 total
Time:        1.458 s
```

## schema-validate

명령: `pnpm db:validate` / exit `0` / 1.1초

```text
> townbase@0.1.0 db:validate /Users/yanghaechan/prd/workspace-knowledge-agent
> pnpm --filter @townbase/database prisma:validate
> @townbase/database@0.1.0 prisma:validate /Users/yanghaechan/prd/workspace-knowledge-agent/packages/database
> prisma validate
Prisma schema loaded from prisma/schema.prisma
The schema at prisma/schema.prisma is valid 🚀
```

## db-deploy

명령: `pnpm db:deploy` / exit `0` / 1.21초

```text
> townbase@0.1.0 db:deploy /Users/yanghaechan/prd/workspace-knowledge-agent
> pnpm --filter @townbase/database prisma:migrate:deploy
> @townbase/database@0.1.0 prisma:migrate:deploy /Users/yanghaechan/prd/workspace-knowledge-agent/packages/database
> prisma migrate deploy
Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "townbase_v02_test", schema "public" at "127.0.0.1:58716"
7 migrations found in prisma/migrations
Applying migration `20260611153120_init`
Applying migration `20260611170000_tighten_relations`
Applying migration `20260618180000_document_content_hash_index_status`
Applying migration `20260618193000_document_chunking_fields`
Applying migration `20260618195500_document_chunk_embedding`
Applying migration `20260619133000_action_draft_unique_upsert`
Applying migration `20260823120000_document_chunk_embedding_model`
The following migration(s) have been applied:
migrations/
  └─ 20260611153120_init/
    └─ migration.sql
  └─ 20260611170000_tighten_relations/
    └─ migration.sql
  └─ 20260618180000_document_content_hash_index_status/
    └─ migration.sql
  └─ 20260618193000_document_chunking_fields/
    └─ migration.sql
  └─ 20260618195500_document_chunk_embedding/
    └─ migration.sql
  └─ 20260619133000_action_draft_unique_upsert/
    └─ migration.sql
  └─ 20260823120000_document_chunk_embedding_model/
    └─ migration.sql
All migrations have been successfully applied.
```

## db-seed

명령: `pnpm db:seed` / exit `0` / 1.85초

```text
> townbase@0.1.0 db:seed /Users/yanghaechan/prd/workspace-knowledge-agent
> pnpm --filter @townbase/database prisma:seed
> @townbase/database@0.1.0 prisma:seed /Users/yanghaechan/prd/workspace-knowledge-agent/packages/database
> prisma db seed
Running seed command `ts-node --project tsconfig.json prisma/seed.ts` ...
┌─────────────────────────────────────────────────────────┐
│  Update available 6.19.3 -> 8.0.0-rc.25                 │
│                                                         │
│  This is a major update - please follow the guide at    │
│  https://pris.ly/d/major-version-upgrade                │
│                                                         │
│  Run the following to update                            │
│    npm i --save-dev prisma@latest                       │
│    npm i @prisma/client@latest                          │
└─────────────────────────────────────────────────────────┘
🌱  The seed command has been executed.
```

## database-all

명령: `pnpm db:test` / exit `0` / 1.54초

```text
PASS test/database.integration.spec.ts
PASS test/knowledge-gap.spec.ts
PASS test/embedding.spec.ts
PASS test/action-draft.spec.ts
PASS test/retrieval-mode.spec.ts
Test Suites: 5 passed, 5 total
Tests:       14 passed, 14 total
Time:        0.815 s, estimated 1 s
```

## connectors-db

명령: `pnpm --filter @townbase/connectors test --runTestsByPath test/local-repo-db.integration.spec.ts test/notion-db.integration.spec.ts` / exit `0` / 1.65초

```text
PASS test/local-repo-db.integration.spec.ts
PASS test/notion-db.integration.spec.ts
Test Suites: 2 passed, 2 total
Tests:       2 passed, 2 total
Time:        1.09 s
```

## api-http-retry

명령: `pnpm --filter @townbase/api test --runTestsByPath test/app.e2e-spec.ts test/drafts.spec.ts test/knowledge-gaps.spec.ts` / exit `0` / 제한 밖 재시험

```text
PASS test/drafts.spec.ts
PASS test/knowledge-gaps.spec.ts
PASS test/app.e2e-spec.ts
Test Suites: 3 passed, 3 total
Tests:       12 passed, 12 total
Time:        1.664 s
```

## 격리 DB 직접 재조회

```text
current_database: townbase_v02_test
pgvector extension: 0.8.1
finished migrations: 7
Workspace.name: townbase
```

새 컨테이너 `townbase-v02-baseline-20261023`, localhost 임의 포트 58716, 별도 영속 volume 없음. 기존 Compose/운영 DB 미사용. 이미지 `pgvector/pgvector:pg16`, ID `sha256:c3c84b85691a264aa3c5b8fc1d611e67d42b0cca8596e3d3d22dc2424c12c4e2`, arm64. 시험 종료 후 이 컨테이너만 삭제했다.
