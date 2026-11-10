import { spawn } from "node:child_process";
import { boundedFileShutdown } from "../src/files/file-shutdown";
import path from "node:path";
test("normal shutdown drains admitted work before returning", async () => {
  const events: string[] = [];
  await boundedFileShutdown(async () => {
    await Promise.resolve();
    events.push("drained");
  }, 100);
  events.push("returned");
  expect(events).toEqual(["drained", "returned"]);
});
test("stalled shutdown actually terminates a process with an open handle", async () => {
  const modulePath = path.resolve(__dirname, "../dist/files/file-shutdown.js");
  const child = spawn(
    process.execPath,
    [
      "-e",
      `setInterval(()=>{},1000);require(${JSON.stringify(modulePath)}).boundedFileShutdown(()=>new Promise(()=>{}),50);`,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    const deadline = setTimeout(() => {
      child.kill("SIGKILL");
      reject(Error("test_deadline"));
    }, 3000);
    child.once("error", (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    child.once("close", (value) => {
      clearTimeout(deadline);
      resolve(value);
    });
  });
  expect(code).toBe(1);
  expect(stderr).toBe("TOWNBASE_FILE_SHUTDOWN_DEADLINE\n");
});
