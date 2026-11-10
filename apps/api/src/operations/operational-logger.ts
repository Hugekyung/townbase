import { STARTUP_DIAGNOSTIC_CODES } from "../startup-failure";
import type { LoggerService } from "@nestjs/common";
import {
  mkdirSync,
  lstatSync,
  realpathSync,
  statSync,
  constants,
  openSync,
  closeSync,
  writeSync,
} from "node:fs";
import path from "node:path";
import { GROUNDING_DIAGNOSTIC_CODES } from "../rag/rag-policy";
import { operationsPath } from "./deletion-journal";
const DIAGNOSTIC_CODES = new Set([
  ...STARTUP_DIAGNOSTIC_CODES,
  "TOWNBASE_AGENT_SETTINGS_FAILED",
  "TOWNBASE_ATTACHMENT_CLEANUP_FAILED",
  "TOWNBASE_ATTACHMENT_FAILED",
  "TOWNBASE_FILE_CLEANUP_FAILED",
  "TOWNBASE_FILE_OPERATION_FAILED",
  "TOWNBASE_FILE_RUN_CLEANUP_FAILED",
  "TOWNBASE_FILE_RUN_OWNER_LOST",
  "TOWNBASE_FILE_RUN_PROCESSING_FAILED",
  "TOWNBASE_FILE_RUN_REQUEST_FAILED",
  "TOWNBASE_FILE_RUN_SHUTDOWN_UNCONFIRMED",
  "TOWNBASE_OPERATIONS_CLEANUP_FAILED",
  "TOWNBASE_OPERATIONS_UNAVAILABLE",
  "TOWNBASE_PARSER_TERMINATION_FAILED",
  "TOWNBASE_RAG_CLEANUP_FAILED",
  "TOWNBASE_RAG_FAILED",
  "TOWNBASE_RAG_RESULT_PERSIST_FAILED",
  ...GROUNDING_DIAGNOSTIC_CODES,
]);
// Only diagnostic codes survive. Messages/stacks/bodies are never persisted.
export class OperationalLogger implements LoggerService {
  log(_message: unknown) {}
  debug(_message: unknown) {}
  verbose(_message: unknown) {}
  warn(message: unknown) {
    this.record("warn", message);
  }
  error(message: unknown) {
    this.record("error", message);
  }
  private record(level: string, message: unknown) {
    const code =
      typeof message === "string" && DIAGNOSTIC_CODES.has(message)
        ? message
        : "TOWNBASE_APPLICATION_ERROR";
    try {
      const root = path.join(operationsPath(), "diagnostics");
      mkdirSync(root, { recursive: true, mode: 0o700 });
      const s = lstatSync(root);
      if (
        !s.isDirectory() ||
        s.isSymbolicLink() ||
        (s.mode & 0o077) !== 0 ||
        realpathSync(root) !== root
      )
        throw Error();
      const filename = path.join(
        root,
        new Date().toISOString().slice(0, 10) + ".log",
      );
      const fd = openSync(
        filename,
        constants.O_WRONLY |
          constants.O_APPEND |
          constants.O_CREAT |
          constants.O_NOFOLLOW,
        0o600,
      );
      try {
        if (statSync(filename).size < 10 * 1024 * 1024)
          writeSync(
            fd,
            JSON.stringify({ at: new Date().toISOString(), level, code }) +
              "\n",
          );
      } finally {
        closeSync(fd);
      }
    } catch {
      process.stderr.write("TOWNBASE_DIAGNOSTIC_STORAGE_FAILED\n");
    }
  }
}
