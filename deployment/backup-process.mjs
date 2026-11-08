import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { pipeline } from "node:stream/promises";

export const BACKUP_TRANSFER_DEADLINE_MS = 30 * 60_000;

export class BackupChildUnconfirmed extends Error {
  constructor() {
    super("Backup child termination unconfirmed");
    this.cleanupSafe = false;
  }
}

// Local Docker CLI termination is bounded and observed. It is not proof that a
// daemon-side exec has stopped; a failed restore remains offline behind its marker.
export function observeDockerChild(child, deadlineMs, abortIO = () => {}) {
  let failure,
    settled = false,
    deadline,
    retry;
  const finish = (error) => {
    if (settled) return;
    settled = true;
    clearTimeout(deadline);
    clearTimeout(retry);
    error ? rejectDone(error) : resolveDone();
  };
  let resolveDone, rejectDone;
  const done = new Promise((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  const fail = (error) => {
    if (settled || failure) return;
    failure = error;
    abortIO();
    let attempts = 0;
    const kill = () => {
      if (settled) return;
      if (attempts++ === 3) {
        child.unref();
        for (const stream of [child.stdin, child.stdout, child.stderr])
          stream?.destroy();
        return finish(new BackupChildUnconfirmed());
      }
      child.kill("SIGKILL");
      retry = setTimeout(kill, 1000);
    };
    kill();
  };
  child.on("error", (error) =>
    child.pid == null ? finish(error) : fail(error),
  );
  child.once("close", (code) =>
    finish(
      failure ?? (code === 0 ? undefined : Error("Docker operation failed")),
    ),
  );
  child.stdin?.on("error", fail);
  deadline = setTimeout(
    () => fail(Error("Docker operation deadline exceeded")),
    deadlineMs,
  );
  return { done, fail };
}
function checkedDeadline(value, fallback) {
  const deadline = value ?? fallback;
  if (
    !Number.isSafeInteger(deadline) ||
    deadline < 1 ||
    deadline > BACKUP_TRANSFER_DEADLINE_MS
  )
    throw Error("Invalid Docker operation deadline");
  return deadline;
}
export async function docker(argv, stdin, { deadlineMs } = {}) {
  const timeout = checkedDeadline(deadlineMs, 120_000);
  const child = spawn("docker", argv, {
    stdio: [stdin == null ? "ignore" : "pipe", "pipe", "pipe"],
  });
  const life = observeDockerChild(child, timeout);
  const output = [];
  let bytes = 0;
  child.stderr.resume();
  child.stdout.on("data", (b) => {
    bytes += b.length;
    if (bytes > 16 * 1024 * 1024) life.fail(Error("Docker output limit"));
    else output.push(b);
  });
  if (stdin != null) child.stdin.end(stdin);
  await life.done;
  return Buffer.concat(output).toString("utf8");
}
async function streamed(argv, stream, direction, deadlineMs) {
  const controller = new AbortController();
  const child = spawn("docker", argv, {
    stdio:
      direction === "out"
        ? ["ignore", "pipe", "ignore"]
        : ["pipe", "ignore", "ignore"],
  });
  const life = observeDockerChild(
    child,
    checkedDeadline(deadlineMs, BACKUP_TRANSFER_DEADLINE_MS),
    () => controller.abort(),
  );
  const io = (
    direction === "out"
      ? pipeline(child.stdout, stream, { signal: controller.signal })
      : pipeline(stream, child.stdin, { signal: controller.signal })
  ).catch((error) => {
    life.fail(error);
    throw error;
  });
  // Do not let caller delete staging files before local child AND streams close.
  const [termination, transfer] = await Promise.allSettled([life.done, io]);
  if (termination.status === "rejected") throw termination.reason;
  if (transfer.status === "rejected") throw transfer.reason;
}
export async function streamOut(argv, filename, { deadlineMs } = {}) {
  checkedDeadline(deadlineMs, BACKUP_TRANSFER_DEADLINE_MS);
  const handle = await open(filename, "wx", 0o600);
  const stream = handle.createWriteStream();
  try {
    await streamed(argv, stream, "out", deadlineMs);
  } finally {
    stream.destroy();
    await handle.close();
  }
}
export async function streamIn(argv, filename, { deadlineMs } = {}) {
  checkedDeadline(deadlineMs, BACKUP_TRANSFER_DEADLINE_MS);
  const stream = createReadStream(filename);
  try {
    await streamed(argv, stream, "in", deadlineMs);
  } finally {
    stream.destroy();
  }
}
