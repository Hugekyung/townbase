import { createHash } from "node:crypto";
import {
  assertExtraction,
  type FileExtraction,
  type FileSegment,
} from "./file-contract";
import { evidenceUnits } from "./retrieval-text";

export const FILE_INDEX_CONFIGURATION = "file-index-d04-v3";
// Old embeddings stay usable until an explicit, atomic reindex succeeds.
export const READABLE_INDEX_CONFIGURATIONS = [
  "file-index-d04-v2",
  FILE_INDEX_CONFIGURATION,
];
export const CHUNK_BYTES = 4096;
const MAX_PARTS = 128;
// Fixed UTF-8 bound, not an exact tokenizer. Normalize whitespace explicitly;
// offsets still address the original segment (Unicode code points).
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
  assertExtraction(value, value.format);
  if (!Number.isInteger(maxBytes) || maxBytes < 4 || maxBytes > CHUNK_BYTES)
    throw new RangeError("Invalid file chunk bound");
  const chunks: FileChunk[] = [];
  value.segments.forEach((segment, segmentIndex) => {
    let current: FileChunk | undefined;
    let previous: FileChunk | undefined;
    const flush = () => {
      if (current) chunks.push(current);
      current = undefined;
    };
    let offset = 0,
      priorEnd = 0;
    for (const range of evidenceUnits(segment.text)) {
      const text = segment.text.slice(range.start, range.end);
      offset += Array.from(segment.text.slice(priorEnd, range.start)).length;
      const unitOffset = offset;
      offset += Array.from(text).length;
      priorEnd = range.end;
      const pieces = byteChunks(
        {
          ...value,
          codePoints: Array.from(text).length,
          segments: [{ ...segment, text }],
        },
        maxBytes,
      );
      for (const piece of pieces) {
        piece.parts = piece.parts.map((p) => ({
          ...p,
          segment: segmentIndex,
          start: p.start + unitOffset,
          end: p.end + unitOffset,
        }));
        const fits = (a: FileChunk, b: FileChunk) =>
          Buffer.byteLength(a.content + "\n" + b.content) <= maxBytes &&
          a.parts.length + b.parts.length <= MAX_PARTS;
        if (current && !fits(current, piece)) {
          flush();
          if (
            previous &&
            Buffer.byteLength(previous.content) <=
              Math.min(512, maxBytes / 4) &&
            fits(previous, piece)
          )
            current = { ...previous, parts: [...previous.parts] };
        }
        if (current) {
          current.content += "\n" + piece.content;
          current.parts.push(...piece.parts);
          current.contentHash = createHash("sha256")
            .update(current.content)
            .digest("hex");
        } else current = { ...piece, parts: [...piece.parts] };
        // Only overlap a complete unit, never a fragment of a long sentence/table.
        previous = pieces.length === 1 ? piece : undefined;
      }
    }
    flush(); // Pages and source headings never silently merge.
  });
  return chunks;
}
function byteChunks(
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
    for (const match of segment.text.matchAll(/\s+|\S/gu)) {
      const raw = match[0];
      const width = Array.from(raw).length;
      const whitespace = /\s/u.test(raw);
      if (
        whitespace &&
        (match.index === 0 || match.index + raw.length === segment.text.length)
      ) {
        offset += width;
        continue;
      }
      const char = whitespace ? " " : raw;
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
      offset += width;
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
