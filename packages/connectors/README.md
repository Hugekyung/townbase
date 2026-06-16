# packages/connectors

Phase 3 Notion connector package.

## Required environment

- `NOTION_API_KEY`
- `NOTION_ROOT_PAGE_ID`
- `DATABASE_URL=postgresql://townbase:townbase@localhost:5432/townbase?schema=public`

## Commands

- `pnpm --filter @townbase/connectors build`
- `pnpm --filter @townbase/connectors test`
- `pnpm --filter @townbase/connectors notion:sync`

## Phase 3 workflow

1. Start PostgreSQL:

```bash
docker compose up -d postgres
```

2. Apply Prisma migrations:

```bash
DATABASE_URL=postgresql://townbase:townbase@localhost:5432/townbase?schema=public pnpm --filter @townbase/database prisma:migrate:deploy
```

3. Run the connector test surface:

```bash
pnpm --filter @townbase/connectors test
```

4. Run the fixture-backed sync entrypoint:

```bash
NOTION_API_KEY=... NOTION_ROOT_PAGE_ID=... pnpm --filter @townbase/connectors notion:sync
```

## Notes

- This package owns Notion ingestion logic.
- Shared metadata classification lives in `packages/connectors/src/classification.ts`.
- `classifyNotionPage` and `classifyRepositoryPath` use the same deterministic output contract for `sourceType`, `knowledgeTypes`, `domainTags`, and `status`.
- `buildChunkMetadata` exposes the chunk metadata shape that later chunk writers should consume.
- Live Notion API tests are intentionally not required for the Phase 3 plan.
- `pnpm --filter @townbase/connectors test` covers unit, fixture, and Prisma/PostgreSQL-backed integration tests.
- `notion:sync` consumes the bundled fixture at `packages/connectors/fixtures/notion-sync.fixture.json` unless `NOTION_SYNC_FIXTURE_PATH` overrides it, then writes into PostgreSQL through Prisma.
