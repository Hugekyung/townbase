const TEST_DATABASE_NAME_PATTERN = /(^|[_-])test([_-]|$)/i;

export const assertTestDatabase = (): void => {
  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl == null) {
    throw new Error("DATABASE_URL is required for destructive integration-test cleanup");
  }

  const databaseName = new URL(databaseUrl).pathname.replace(/^\//, "");

  if (!TEST_DATABASE_NAME_PATTERN.test(databaseName)) {
    throw new Error(
      `Refusing destructive integration-test cleanup for database '${databaseName}'. ` +
        "Use a database name containing 'test'.",
    );
  }
};
