import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { databaseEnvironment } from "./database-env.mjs";

let prisma;
try {
  const databaseUrl = new URL(databaseEnvironment());
  // Readiness probes use a short socket timeout; schema changes may take longer.
  databaseUrl.searchParams.delete("socket_timeout");
  process.env.DATABASE_URL = databaseUrl.toString();
  const requireDatabase = createRequire(
    new URL("../packages/database/package.json", import.meta.url),
  );
  const { PrismaClient, resolveDefaultWorkspaceName } =
    requireDatabase("./dist/index.js");
  prisma = new PrismaClient();
  await prisma.$transaction(
    async (tx) => {
      // Pin one DB connection while CLI migrations use another connection.
      const [lock] =
        await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(741126, 2) AS acquired`;
      if (!lock?.acquired)
        throw new Error("Migration runner is already active");
      await promisify(execFile)("pnpm", ["db:deploy"], {
        timeout: 240000,
        maxBuffer: 1048576,
      });
      const name = resolveDefaultWorkspaceName();
      await tx.workspace.upsert({
        where: { name },
        create: { name },
        update: {},
      });
    },
    { timeout: 300000, maxWait: 10000 },
  );
  console.log("Database migrations and workspace seed completed.");
} catch {
  // Do not echo CLI/connection errors which may contain credentials.
  console.error(
    "Database preparation failed. Check database health, migration state and concurrent runners before retrying.",
  );
  process.exitCode = 1;
} finally {
  await prisma?.$disconnect();
}
