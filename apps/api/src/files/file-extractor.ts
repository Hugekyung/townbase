import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { realpathSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  FILE_ERRORS,
  assertExtraction,
  FILE_LIMITS,
  FileError,
  fileFormat,
  type FileExtraction,
} from "./file-contract";

// One local parser at a time. D03 adds the persisted indexing queue, not a worker server.
export class FileExtractor {
  private busy = false;
  private cancelActive: (() => void) | undefined;
  cancel(): void {
    this.cancelActive?.();
  }
  // A request may finish before the OS can reap its child. Never admit another
  // parser until that child closes (or the operator restarts this process).
  private strandedChild: ChildProcess | null = null;
  async extract(
    fileName: string,
    input: Buffer,
    abortSignal?: AbortSignal,
  ): Promise<FileExtraction> {
    if (abortSignal?.aborted) throw new FileError("extraction_cancelled");
    if (process.env.NODE_ENV === "production" && process.platform !== "linux")
      throw new FileError("parser_unavailable");
    if (this.strandedChild !== null) throw new FileError("parser_unavailable");
    const format = fileFormat(fileName);
    if (input.length > FILE_LIMITS.bytes) throw new FileError("file_too_large");
    if (this.busy) throw new FileError("parser_busy");
    // Snapshot bytes before any await. The caller cannot mutate a file during extraction.
    const bytes = Buffer.from(input);
    const worker = path.join(__dirname, "parser-worker.js");
    if (!existsSync(worker)) throw new FileError("parser_unavailable");
    this.busy = true;
    const cancel = () => this.cancel();
    try {
      const dependencyRoot = realpathSync(
        path.join(__dirname, "../../node_modules"),
      );
      const packageRoots = [
        "mammoth",
        "yauzl",
        "pdfjs-dist",
        "@townbase/rag-core",
      ].map((name) => {
        const manifest = realpathSync(require.resolve(`${name}/package.json`));
        // pnpm dependencies live in a sibling node_modules tree, not the symlink directory.
        const marker = manifest.indexOf(`${path.sep}node_modules${path.sep}`);
        return manifest.slice(0, marker + "/node_modules".length);
      });
      const args = [
        "--jitless",
        "--max-old-space-size=128",
        "--max-semi-space-size=4",
        "--disable-wasm-trap-handler",
        "--permission",
        "--allow-addons",
        `--allow-fs-read=${__dirname}`,
        `--allow-fs-read=${dependencyRoot}`,
        ...[...new Set(packageRoots)].map((root) => `--allow-fs-read=${root}`),
        `--allow-fs-read=${path.dirname(realpathSync(require.resolve("@townbase/rag-core/package.json")))}`,
        worker,
        format,
      ];
      // Linux RLIMIT_DATA caps anonymous allocations (heap + buffers) at 512 MiB.
      // JIT is disabled because its address reservations otherwise exceed this limit.
      const linux = process.platform === "linux";
      const child = linux
        ? spawn(
            "/bin/bash",
            [
              "-c",
              'ulimit -c 0; ulimit -d 524288 || exit 70; exec "$@"',
              "townbase-parser",
              process.execPath,
              ...args,
            ],
            {
              cwd: tmpdir(),
              env: { LANG: "C.UTF-8", TZ: "UTC" },
              stdio: ["pipe", "ignore", "ignore", "pipe"],
            },
          )
        : spawn(process.execPath, args, {
            cwd: tmpdir(),
            env: { LANG: "C.UTF-8", TZ: "UTC" },
            stdio: ["pipe", "ignore", "ignore", "pipe"],
          });
      return await new Promise<FileExtraction>((resolve, reject) => {
        let reason: FileError | undefined,
          total = 0,
          closed = false,
          settled = false,
          stopping = false,
          attempts = 0;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let monitor: ReturnType<typeof setInterval> | undefined;
        let retry: ReturnType<typeof setTimeout> | undefined;
        let terminationDeadline: ReturnType<typeof setTimeout> | undefined;
        const chunks: Buffer[] = [];
        const channel = child.stdio[3] as import("node:stream").Readable | null;
        const clean = () => {
          clearTimeout(timer);
          clearInterval(monitor);
          clearTimeout(retry);
          clearTimeout(terminationDeadline);
        };
        const quarantine = () => {
          if (closed || settled) return;
          this.strandedChild = child;
          settled = true;
          clean();
          chunks.length = 0;
          // Keep the process reference and close listener, but do not retain the
          // request body or keep accepting output from an unreaped parser.
          child.stdin?.destroy();
          channel?.destroy();
          console.error("TOWNBASE_PARSER_TERMINATION_FAILED");
          reject(new FileError("parser_unavailable"));
        };
        const signal = () => {
          if (closed || settled) return;
          attempts++;
          try {
            child.kill("SIGKILL");
          } catch {
            reason ??= new FileError("parser_unavailable");
          }
          if (!closed && !settled && attempts < 3)
            retry = setTimeout(signal, 250);
        };
        const stop = (code: FileError["code"]) => {
          reason ??= new FileError(code);
          if (stopping || closed || settled) return;
          stopping = true;
          clearTimeout(timer);
          clearInterval(monitor);
          // A successful kill() return only means the signal was sent. Bound
          // termination even when no error and no close ever arrive.
          terminationDeadline = setTimeout(quarantine, 1000);
          signal();
        };
        this.cancelActive = () => stop("extraction_cancelled");
        abortSignal?.addEventListener("abort", cancel, { once: true });
        timer = setTimeout(
          () => stop("extraction_timeout"),
          FILE_LIMITS.timeoutMs,
        );
        if (linux)
          monitor = setInterval(() => {
            try {
              const status = readFileSync(`/proc/${child.pid}/status`, "utf8");
              const match = /^VmRSS:\s+(\d+)\s+kB/m.exec(status);
              if (match && Number(match[1]) * 1024 > FILE_LIMITS.memoryBytes)
                stop("extraction_limit");
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT")
                stop("parser_unavailable");
            }
          }, 20);
        child.on("error", () => stop("parser_unavailable"));
        channel?.on("data", (chunk: Buffer) => {
          if (stopping || settled) return;
          total += chunk.length;
          if (total > 8 * 1024 * 1024) stop("extraction_limit");
          else chunks.push(chunk);
        });
        channel?.on("error", () => stop("parser_failed"));
        child.stdin?.on("error", () => undefined); // EPIPE is finalized on close/deadline.
        child.once("close", (code) => {
          closed = true;
          clean();
          if (this.strandedChild === child) this.strandedChild = null;
          if (settled) return;
          settled = true;
          if (reason) return reject(reason);
          if (code !== 0) return reject(new FileError("parser_failed"));
          try {
            const message = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (message.ok !== true) {
              if (FILE_ERRORS.includes(message.code))
                return reject(new FileError(message.code));
              throw new Error("Invalid child result");
            }
            const result: unknown = message.result;
            assertExtraction(result, format);
            resolve(result);
          } catch {
            reject(new FileError("parser_failed"));
          }
        });
        if (!channel || !child.stdin) stop("parser_unavailable");
        else child.stdin.end(bytes);
      });
    } finally {
      abortSignal?.removeEventListener("abort", cancel);
      this.cancelActive = undefined;
      this.busy = false;
    }
  }
}
