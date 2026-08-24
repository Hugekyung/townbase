export const DEFAULT_WORKSPACE_NAME = "townbase";

export const resolveDefaultWorkspaceName = (): string =>
  process.env.TOWNBASE_DEFAULT_WORKSPACE_NAME ?? DEFAULT_WORKSPACE_NAME;

export const DEFAULT_DATABASE_URL =
  "postgresql://townbase:townbase@localhost:5432/townbase?schema=public";
