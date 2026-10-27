import { writeSync } from "node:fs";
import { parseFile } from "./file-parser";
import {
  FILE_ERRORS,
  FILE_LIMITS,
  FileError,
  type FileFormat,
} from "./file-contract";

function send(value: string): void {
  const bytes = Buffer.from(value);
  let offset = 0;
  while (offset < bytes.length) {
    const written = writeSync(3, bytes, offset, bytes.length - offset);
    if (written === 0) throw new FileError("parser_failed");
    offset += written;
  }
}

async function main(): Promise<void> {
  const format = process.argv[2] as FileFormat;
  if (!["pdf", "docx", "md", "txt"].includes(format))
    throw new FileError("unsupported_format");
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    const value = chunk as Buffer;
    size += value.length;
    if (size > FILE_LIMITS.bytes) throw new FileError("file_too_large");
    chunks.push(value);
  }
  const result = await parseFile(Buffer.concat(chunks, size), format);
  const serialized = JSON.stringify({ ok: true, result });
  if (Buffer.byteLength(serialized) > 8 * 1024 * 1024)
    throw new FileError("extraction_limit");
  send(serialized);
}
void main()
  .catch((error: unknown) => {
    const code =
      error instanceof FileError && FILE_ERRORS.includes(error.code)
        ? error.code
        : "parser_failed";
    send(JSON.stringify({ ok: false, code }));
  })
  .finally(() => process.exit(0));
