# townbase

townbase is a local-first knowledge agent for onboarding and product-history exploration across Notion and Git repositories.

## Phase 0 status

- NestJS API scaffold: done
- PostgreSQL + pgvector compose setup: done
- Package workspace scaffolding: done
- Web UI: intentionally deferred for later phases

## Local development

```bash
pnpm install
pnpm --filter @townbase/api dev
```

Health check:

```bash
curl http://localhost:3000/health
```

## Docker

```bash
docker compose up -d
```

## Phase 3 connector workflow

The Notion connector lives in `packages/connectors` and uses the local PostgreSQL container.

```bash
docker compose up -d postgres
DATABASE_URL=postgresql://townbase:townbase@localhost:5432/townbase?schema=public pnpm --filter @townbase/database prisma:migrate:deploy
pnpm --filter @townbase/connectors test
NOTION_API_KEY=... NOTION_ROOT_PAGE_ID=... pnpm --filter @townbase/connectors notion:sync
```

`pnpm --filter @townbase/connectors test` covers fixture-based parsing/sync tests and Prisma/PostgreSQL-backed verification.
The connector package also exposes the shared metadata classifier used for Notion and repository path rules in Phase 2.
`pnpm --filter @townbase/connectors notion:sync` consumes `packages/connectors/fixtures/notion-sync.fixture.json` unless `NOTION_SYNC_FIXTURE_PATH` overrides it.

## Repository layout

```text
apps/
  api/        NestJS API server
packages/
  connectors/ Planned data connectors
  rag-core/   Planned retrieval core
  agent-core/  Planned orchestration layer
  database/   Planned schema and persistence layer
repos/        Mounted local Git repositories for ingestion
```
