# Local-first Execution Guide

This guide covers the v0.1 local-first flow. The primary interaction path is MCP-first; the web UI is deferred to later phases.

## 1. Prerequisites

- Node.js and pnpm installed
- Docker installed and running
- A local `repos/` directory for selected Git repositories
- Notion credentials if you want to ingest Notion pages
- OpenAI API credentials if you want the full embedding / answer path rather than fixture-only or fallback behavior

## 2. Environment variables

Use `.env.example` as the starting point. The main variables are:

- `DATABASE_URL`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DB`
- `OPENAI_API_KEY`
- `OPENAI_CHAT_MODEL`
- `OPENAI_EMBEDDING_MODEL`
- `OPENAI_EMBEDDING_BASE_URL`
- `NOTION_API_KEY`
- `NOTION_ROOT_PAGE_ID`
- `REPO_ROOT_PATH`
- `LOCAL_REPO_NAMES`

## 3. Local bootstrap

```bash
docker compose up -d
pnpm install
DATABASE_URL=postgresql://townbase:townbase@localhost:5432/townbase?schema=public pnpm --filter @townbase/database prisma:migrate:deploy
pnpm --filter @townbase/api dev
```

## 4. Prepare local repository corpus

```bash
mkdir -p /absolute/path/to/repos
git clone --local . /absolute/path/to/repos/workspace-knowledge-agent
```

## 5. Ingest Notion

```bash
pnpm --filter @townbase/connectors notion:sync
```

`notion:sync` reads the live Notion root page configured in `.env`. Make sure the root page is shared with the integration token before you run it.

If you need fixture replay for local smoke tests, run:

```bash
pnpm --filter @townbase/connectors notion:sync:fixture
```

## 6. Ingest selected local repositories

```bash
pnpm --filter @townbase/connectors local-repo:sync
```

Only the explicitly selected repositories are ingested.

## 7. Sample repository structure

```text
repos/
  workspace-knowledge-agent/
    README.md
    docs/
    adr/
    architecture/
    prd/
    schema.prisma
    migrations/
```

## 8. Sample Notion page structure

- Product overview page
- Architecture note page
- Policy or process page
- Release or incident follow-up page

Keep the content source-grounded and avoid pages that are primarily generated output.

## 9. Sample questions

- Onboarding: "Where do I start when I join this project?"
- Product history: "Why was the local repository connector added?"
- Documentation gap: "What documentation is still missing for the local repo sync flow?"

## 10. Troubleshooting

- If sync fails, verify the environment variables first.
- If `local-repo:sync` finds nothing, confirm that `LOCAL_REPO_NAMES` points to real directories under `REPO_ROOT_PATH`.
- If `notion:sync` cannot run, check `NOTION_API_KEY` and `NOTION_ROOT_PAGE_ID`.
- If `notion:sync` returns `object_not_found`, share the configured root page with the Notion integration or verify that the token has access to that workspace.
- If `notion:sync:fixture` fails, confirm that the fixture file path exists relative to the repository root.
- If embeddings are unavailable, confirm `OPENAI_API_KEY` or expect fallback/local behavior where supported.
- If PostgreSQL is not reachable, start Docker and rerun the migration command.

## 11. Security and exclude rules

Do not index or sync generated files, secrets, dependency artifacts, build output, or obvious credential files.

The current local-repo scanner excludes:

- `.git`
- `node_modules`
- `dist`
- `build`
- `secrets`
- `credentials`
- `tmp`
- `coverage`
- `logs`
- `.env*`
- `*.pem`
- `*.key`
- `*.crt`

The selected-repo sync path only ingests repository names explicitly passed on the command line or through `LOCAL_REPO_NAMES`.
