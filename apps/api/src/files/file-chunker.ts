import { createHash } from "node:crypto";
import {
  assertExtraction,
  type FileExtraction,
  type FileSegment,
} from "./file-contract";

export const FILE_INDEX_CONFIGURATION = "file-index-d04-v1";
export const CHUNK_BYTES = 4096;
const MAX_PARTS = 128;
// Fixed UTF-8 bound, not an exact tokenizer. Keep original text and per-segment offsets.
export type FileChunk = {
  content: string;
  contentHash: string;
  headingPath: string[];
  parts: Array<{
    segment: number;
    start: number;
    end: number;
    location: FileSegment["location"];
    headingPath: string[];
  }>;
};
export function fileChunks(
  value: FileExtraction,
  maxBytes = CHUNK_BYTES,
): FileChunk[] {
  if (!Number.isInteger(maxBytes) || maxBytes < 4 || maxBytes > CHUNK_BYTES)
    throw new RangeError("Invalid file chunk bound");
  assertExtraction(value, value.format);
  const chunks: FileChunk[] = [];
  let content = "",
    bytes = 0,
    parts: FileChunk["parts"] = [];
  const flush = () => {
    if (content.trim())
      chunks.push({
        content,
        contentHash: createHash("sha256").update(content).digest("hex"),
        headingPath: [...(parts[0]?.headingPath ?? [])],
        parts,
      });
    content = "";
    bytes = 0;
    parts = [];
  };
  value.segments.forEach((segment, index) => {
    if (parts.length >= MAX_PARTS) flush();
    if (content) {
      if (bytes + 1 > maxBytes) flush();
      else {
        content += "\n";
        bytes++;
      }
    }
    let offset = 0;
    let part: FileChunk["parts"][number] | undefined;
    for (const char of segment.text) {
      const size = Buffer.byteLength(char);
      if (bytes + size > maxBytes) {
        flush();
        part = undefined;
      }
      if (!part) {
        part = {
          segment: index,
          start: offset,
          end: offset,
          location: { ...segment.location },
          headingPath: [...segment.headingPath],
        };
        parts.push(part);
      }
      content += char;
      bytes += size;
      offset++;
      part.end = offset;
    }
  });
  flush();
  return chunks;
}
export function embeddingVector(value: unknown): asserts value is number[] {
  if (
    !Array.isArray(value) ||
    value.length !== 1536 ||
    Array.from(value).some((n) => typeof n !== "number" || !Number.isFinite(n))
  )
    throw new Error("embedding_dimension_or_value_mismatch");
  const norm = value.reduce((sum, n) => sum + n * n, 0);
  // The fixed provider returns normalized vectors. Reject zero/underflow/overflow
  // before PostgreSQL's float32 distance operations can produce invalid scores.
  if (!Number.isFinite(norm) || norm <= 1e-30 || norm >= 1e30)
    throw new Error("embedding_dimension_or_value_mismatch");
}
export function chunkRequestId(run: string, ordinal: number): string {
  const h = createHash("sha256")
    .update(`file-index:${run}:${ordinal}`)
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
