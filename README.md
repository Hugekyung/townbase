# townbase

townbase is a local-first knowledge agent for onboarding and product-history exploration across Notion and Git repositories.

## What this repo supports

- MCP-first question answering against local Notion and repository content
- Knowledge Gap tracking and copy-friendly draft generation
- Local ingestion of Notion pages and selected repository documentation

Web UI and HTTP chat/web app paths are deferred to later phases.

## Local-first quickstart

1. Copy `.env.example` and fill in the required values.
2. Start PostgreSQL with Docker:

```bash
docker compose up -d
```

3. Apply database migrations:

```bash
DATABASE_URL=postgresql://townbase:townbase@localhost:5432/townbase?schema=public pnpm --filter @townbase/database prisma:migrate:deploy
```

4. Install dependencies:

```bash
pnpm install
```

5. Run the API in development mode:

```bash
pnpm --filter @townbase/api dev
```

6. Run connectors when you want to ingest Notion or selected local repos:

```bash
NOTION_API_KEY=... NOTION_ROOT_PAGE_ID=... pnpm --filter @townbase/connectors notion:sync
REPO_ROOT_PATH=./repos LOCAL_REPO_NAMES=workspace-knowledge-agent pnpm --filter @townbase/connectors local-repo:sync
```

7. Use an MCP client such as ChatGPT or Codex to ask questions against the running server.

Health check:

```bash
curl http://localhost:3000/health
```

## Execution guide

For the full local-first setup, sample structures, sample questions, troubleshooting, security notes, and exclude rules, read [docs/local-first-execution.md](docs/local-first-execution.md).

## Connector details

The connector package documents its runtime commands and environment in [packages/connectors/README.md](packages/connectors/README.md).

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
