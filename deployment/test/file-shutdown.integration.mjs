// Explicit opt-in Docker stop test. No DB, mounted data, secrets or provider calls.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
const exec = promisify(execFile);
assert.equal(process.env.TOWNBASE_SHUTDOWN_DOCKER_TEST, "1");
const image = process.env.TOWNBASE_SHUTDOWN_IMAGE;
assert.ok(image, "Set an existing local runtime image");
const docker = async (args) => {
  const result = await exec("docker", args, {
    timeout: 75_000,
    maxBuffer: 1024 * 1024,
  });
  return (
    args[0] === "logs" ? result.stdout + result.stderr : result.stdout
  ).trim();
};
const config = JSON.parse(
  await docker([
    "compose",
    "-p",
    "townbase-local",
    "--env-file",
    ".townbase/compose.env",
    "config",
    "--format",
    "json",
  ]),
);
const grace = config.services.api.stop_grace_period;
assert.equal(grace, "1m0s"); // Docker normalizes the configured 60s duration.
const expectedHash = createHash("sha256")
  .update(await readFile("apps/api/dist/files/file-shutdown.js"))
  .digest("hex");
const name = "townbase-shutdown-test-" + randomUUID();
try {
  const code = `const {createHash}=require('node:crypto');const fs=require('node:fs');const modulePath='/app/api/dist/files/file-shutdown.js';const {boundedFileShutdown}=require(modulePath);process.on('SIGTERM',()=>{void boundedFileShutdown(()=>new Promise(()=>{}));});setInterval(()=>{},1000);console.log('READY:'+createHash('sha256').update(fs.readFileSync(modulePath)).digest('hex'));`;
  await docker([
    "run",
    "-d",
    "--name",
    name,
    "--init",
    "--network",
    "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--stop-timeout",
    "60",
    image,
    "node",
    "-e",
    code,
  ]);
  let ready = false;
  for (let i = 0; i < 40; i++) {
    const logs = await docker(["logs", name]);
    if (logs.includes("READY:")) {
      assert.equal(logs, "READY:" + expectedHash);
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, "test process did not start");
  assert.equal(
    await docker(["inspect", "--format", "{{.Config.StopTimeout}}", name]),
    "60",
  );
  const start = performance.now();
  await docker(["stop", name]);
  const elapsedMs = performance.now() - start;
  const state = JSON.parse(
    await docker(["inspect", "--format", "{{json .State}}", name]),
  );
  assert.equal(state.ExitCode, 1); // SIGKILL would be 137, not watchdog exit(1).
  assert.equal(state.Running, false);
  assert.ok(elapsedMs >= 44_000 && elapsedMs < 60_000);
  const logs = await docker(["logs", name]);
  assert.ok(logs.includes("TOWNBASE_FILE_SHUTDOWN_DEADLINE"));
  console.log(
    JSON.stringify({
      composeGraceSeconds: 60,
      watchdogMs: 45_000,
      elapsedMs,
      exitCode: state.ExitCode,
      helperHash: expectedHash,
      paidCalls: 0,
    }),
  );
} finally {
  // Report cleanup failure separately; it must not replace the original test failure.
  try {
    await docker(["rm", "-f", name]);
  } catch {
    console.error("TOWNBASE_SHUTDOWN_CLEANUP_FAILED");
    process.exitCode = 1;
  }
}
