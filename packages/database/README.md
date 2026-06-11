# packages/database

Prisma schema, migrations, seed flow, and integration tests for townbase live here.

## Commands

- `pnpm --filter @townbase/database prisma:generate`
- `pnpm --filter @townbase/database prisma:validate`
- `pnpm --filter @townbase/database prisma:migrate -- --name <migration_name>`
- `pnpm --filter @townbase/database prisma:migrate:deploy`
- `pnpm --filter @townbase/database prisma:seed`
- `pnpm --filter @townbase/database test`

## Runtime assumptions

- `DATABASE_URL` must point at a PostgreSQL instance.
- The local development database is provided by `docker-compose.yml`.
- The default seed creates a single workspace named `townbase`.
