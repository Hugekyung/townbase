import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Diagnostic keys only. Obtain both before publishing any measurement.
export async function runLockDiagnostic(
  createClient,
  {
    wait = () => new Promise((resolve) => setTimeout(resolve, 500)),
    publish = (value) => console.log(value),
  } = {},
) {
  const clients = [];
  const initial = [];
  try {
    for (const [key, lifetime] of [
      [98, 2],
      [99, 0],
    ]) {
      const p = createClient(lifetime);
      clients.push({ p, key, lifetime });
      const acquired =
        await p.$queryRaw`SELECT pg_backend_pid() AS pid,pg_try_advisory_lock(741126,${key}::int) AS acquired`;
      if (acquired.length !== 1 || acquired[0].acquired !== true)
        throw new Error("TOWNBASE_DIAGNOSTIC_LOCK_BUSY");
      initial.push({ lifetime, acquired });
    }
    initial.forEach(publish);
    for (let i = 0; i < 16; i++) {
      await wait();
      for (const { p, key, lifetime } of clients)
        publish({
          i,
          lifetime,
          rows: await p.$queryRaw`SELECT pg_backend_pid() AS pid, EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND classid=741126::oid AND objid=${key}::oid AND objsubid=2) AS owned`,
        });
    }
  } finally {
    await Promise.all(clients.map(({ p }) => p.$disconnect()));
  }
}
async function main() {
  const { databaseEnvironment } =
    await import("/app/deployment/database-env.mjs");
  const require = createRequire("/app/api/dist/main.js");
  const { PrismaClient } = require("@townbase/database");
  await runLockDiagnostic((lifetime) => {
    const url = new URL(databaseEnvironment());
    url.searchParams.set("connection_limit", "1");
    url.searchParams.set("max_idle_connection_lifetime", String(lifetime));
    return new PrismaClient({ datasources: { db: { url: url.toString() } } });
  });
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  void main().catch((error) => {
    console.error(
      error?.message === "TOWNBASE_DIAGNOSTIC_LOCK_BUSY"
        ? error.message
        : "TOWNBASE_DIAGNOSTIC_FAILED",
    );
    process.exitCode = 1;
  });
