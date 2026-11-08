import { spawn } from "node:child_process";
// Resolve only after the child has closed, so caller finally can safely remove
// plaintext staging files. stdin EPIPE is a handled operation failure.
export function docker(argv, stdin) {
  const child = spawn("docker", argv, {
    stdio: [stdin == null ? "ignore" : "pipe", "pipe", "pipe"],
  });
  let failure,
    bytes = 0;
  const output = [];
  child.stderr.resume();
  child.stdout.on("data", (b) => {
    bytes += b.length;
    if (bytes > 16 * 1024 * 1024) {
      failure = Error("Docker output limit");
      child.kill("SIGKILL");
    } else output.push(b);
  });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.stdin?.once("error", (error) => {
      failure = error;
      child.kill("SIGKILL");
    });
    child.once("close", (code) =>
      failure || code !== 0
        ? reject(failure ?? Error("Docker operation failed"))
        : resolve(Buffer.concat(output).toString("utf8")),
    );
    if (stdin != null) child.stdin.end(stdin);
  });
}
