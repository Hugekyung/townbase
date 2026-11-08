// Developer-only migration-image entrypoint; never copied to the runtime image.
// Mount synthetic fixtures and separately approved secrets. Never reads .env.
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
if (process.env.TOWNBASE_LIVE_EVALUATION !== "1")
  throw Error("Explicit live evaluation approval required");
const corpus = process.env.TOWNBASE_EVAL_CORPUS;
if (!["ops", "shop", "attachments"].includes(corpus))
  throw Error("Explicit synthetic corpus required");
const database = corpus === "attachments" ? "diagnostic" : corpus;
const url = new URL(
  `postgresql://townbase@postgres:5432/townbase_live_${database}_test`,
);
url.password = (await readFile("/run/secrets/owner_password", "utf8")).trim();
const child = spawn(
  "pnpm",
  [
    "--filter",
    "@townbase/api",
    "exec",
    "ts-node",
    "--transpile-only",
    `scripts/evaluate-${corpus === "attachments" ? "attachments" : "basic"}.ts`,
  ],
  {
    detached: true,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url.toString() },
  },
);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
  process.on(signal, () => {
    if (child.pid == null) return;
    try {
      process.kill(-child.pid, signal);
    } catch (e) {
      if (e.code !== "ESRCH") throw e;
    }
  });
child.once("error", () => {
  process.stderr.write("TOWNBASE_EVALUATION_FAILED\n");
  process.exit(1);
});
child.once("close", (code) => process.exit(code ?? 1));
