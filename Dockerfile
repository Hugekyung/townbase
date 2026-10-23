# syntax=docker/dockerfile:1
FROM node:24.19.0-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

FROM base AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm install --global pnpm@10.33.2
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/rag-core/package.json packages/rag-core/package.json
COPY packages/agent-core/package.json packages/agent-core/package.json
COPY packages/connectors/package.json packages/connectors/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:1/build_test pnpm db:generate
RUN pnpm build
RUN pnpm --filter @townbase/api deploy --legacy --prod /out/api
RUN node deployment/copy-prisma-client.mjs /out/api

FROM build AS migration
USER node
CMD ["node", "deployment/migrate.mjs"]

FROM base AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
ENV TOWNBASE_RUNTIME_PROFILE=self_hosted
ENV TOWNBASE_MIGRATIONS_PATH=/app/migrations
ENV TOWNBASE_DOCUMENTS_PATH=/var/lib/townbase/documents
ENV TOWNBASE_ATTACHMENTS_PATH=/var/lib/townbase/attachments
WORKDIR /app
COPY --from=build --chown=node:node /out/api /app/api
COPY --from=build --chown=node:node /workspace/apps/web/dist /app/web/dist
COPY --from=build /workspace/packages/database/prisma/migrations /app/migrations
COPY --chown=node:node deployment/start.mjs deployment/database-env.mjs /app/deployment/
RUN install -d -o node -g node -m 0700 /var/lib/townbase/documents /var/lib/townbase/attachments
USER node
EXPOSE 3000
CMD ["node", "deployment/start.mjs"]
