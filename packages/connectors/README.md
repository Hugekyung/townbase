# packages/connectors

Phase 3 Notion connector package.

## Required environment

- `NOTION_API_KEY`
- `NOTION_ROOT_PAGE_ID`

## Commands

- `pnpm --filter @townbase/connectors build`
- `pnpm --filter @townbase/connectors test`
- `pnpm --filter @townbase/connectors notion:sync`

## Notes

- This package owns Notion ingestion logic.
- Live Notion API tests are intentionally not required for the Phase 3 plan.
