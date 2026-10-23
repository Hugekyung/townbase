import { databaseEnvironment } from "./database-env.mjs";

try {
  process.env.DATABASE_URL = databaseEnvironment();
  await import("../api/dist/main.js");
} catch {
  console.error(
    "Unable to start the runtime. Check deployment artifacts and database secret configuration.",
  );
  process.exit(1);
}
