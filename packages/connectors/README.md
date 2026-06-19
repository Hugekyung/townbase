# packages/connectors

Connector package for Notion and selected local repository ingestion.

## Required environment

- `NOTION_API_KEY`
- `NOTION_ROOT_PAGE_ID`
- `DATABASE_URL=postgresql://townbase:townbase@localhost:5432/townbase?schema=public`

Local repository sync also uses:

- `REPO_ROOT_PATH=./repos`
- `LOCAL_REPO_NAMES=<repo-name>[,<repo-name>...]`

## Commands

- `pnpm --filter @townbase/connectors build`
- `pnpm --filter @townbase/connectors test`
- `pnpm --filter @townbase/connectors notion:sync`
- `REPO_ROOT_PATH=./repos LOCAL_REPO_NAMES=<repo-name> pnpm --filter @townbase/connectors local-repo:sync`

## Workflow

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

4. Ingest Notion pages:

```bash
NOTION_API_KEY=... NOTION_ROOT_PAGE_ID=... pnpm --filter @townbase/connectors notion:sync
```

5. Ingest selected local repositories:

```bash
REPO_ROOT_PATH=./repos LOCAL_REPO_NAMES=workspace-knowledge-agent pnpm --filter @townbase/connectors local-repo:sync
```

## Notes

- `packages/connectors/src/classification.ts` owns the shared metadata classification contract.
- `classifyNotionPage` and `classifyRepositoryPath` use the same deterministic output contract for `sourceType`, `knowledgeTypes`, `domainTags`, and `status`.
- `buildChunkMetadata` exposes the chunk metadata shape that later chunk writers consume.
- Phase 5 API orchestration can normalize Notion and local-repo results with `normalizeNotionSyncSummary` and `normalizeLocalRepoSyncSummary`, which expose `created`, `updated`, `skipped`, `failed`, `archived`, `failures`, and a `phase6_chunking_deferred` index boundary.
- Local repo sync only ingests repositories that are explicitly selected on the command line.
- `notion:sync` consumes the bundled fixture at `packages/connectors/fixtures/notion-sync.fixture.json` unless `NOTION_SYNC_FIXTURE_PATH` overrides it, then writes into PostgreSQL through Prisma.
- `local-repo:sync` reads the selected repos under `./repos`, applies the Phase 4 include/exclude rules, and writes `Document` rows through Prisma.
- For the full local-first execution guide, sample structures, troubleshooting, security notes, and exclude rules, read [docs/local-first-execution.md](../../docs/local-first-execution.md).
