import { databaseEnvironment } from "./database-env.mjs";
try {
  process.env.DATABASE_URL = databaseEnvironment();
  await import("../api/dist/setup/issue-token.js");
} catch {
  console.error("Unable to issue a bootstrap token. Check deployment configuration.");
  process.exitCode = 1;
}
