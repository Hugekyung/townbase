import { databaseEnvironment } from "./database-env.mjs";
try {
  process.env.DATABASE_URL = databaseEnvironment();
  await import("../api/dist/auth/issue-recovery.js");
} catch {
  console.error(
    "Unable to issue recovery token. Check deployment configuration.",
  );
  process.exitCode = 1;
}
