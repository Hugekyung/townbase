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

