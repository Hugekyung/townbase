export const FILE_LIMITS = Object.freeze({
  bytes: 20 * 1024 * 1024,
  codePoints: 300_000,
  timeoutMs: 30_000,
  memoryBytes: 512 * 1024 * 1024,
  zipBytes: 100 * 1024 * 1024,
  zipEntries: 1_000,
  zipRatio: 100,
});
export type FileFormat = "pdf" | "docx" | "md" | "txt";
export const FILE_ERRORS = [
  "unsupported_format",
  "file_too_large",
  "invalid_format",
  "invalid_utf8",
  "encrypted_file",
  "no_extractable_text",
  "extraction_limit",
  "archive_limit",
  "unsafe_archive",
  "extraction_timeout",
  "extraction_cancelled",
  "parser_unavailable",
  "parser_failed",
  "parser_busy",
  "storage_unavailable",
] as const;
export type FileErrorCode = (typeof FILE_ERRORS)[number];
export class FileError extends Error {
  constructor(readonly code: FileErrorCode) {
    super(code);
  }
}
export type FileSegment = {
  text: string;
  location: {
    page?: number;
    paragraph?: number;
    lineStart?: number;
    lineEnd?: number;
  };
  headingPath: string[];
};
export type FileExtraction = {
  format: FileFormat;
  segments: FileSegment[];
  codePoints: number;
};
export function fileFormat(name: string): FileFormat {
  // Never accept a path, hidden/secret file, control characters or ambiguous suffix.
  if (
    name.length === 0 ||
    name.length > 255 ||
    /[\\/\x00-\x1f\x7f]/.test(name) ||
    name.startsWith(".")
  )
    throw new FileError("unsupported_format");
  const extension = name.split(".").at(-1)?.toLowerCase();
  if (
    extension !== "pdf" &&
    extension !== "docx" &&
    extension !== "md" &&
    extension !== "txt"
  )
    throw new FileError("unsupported_format");
  return extension;
}

// Child output is a transport boundary: validate structure, locations and actual text count.
export function assertExtraction(
  value: unknown,
  format: FileFormat,
): asserts value is FileExtraction {
  if (value == null || typeof value !== "object")
    throw new FileError("parser_failed");
  const result = value as FileExtraction;
  if (
    result.format !== format ||
    !Number.isSafeInteger(result.codePoints) ||
    result.codePoints < 1 ||
    result.codePoints > FILE_LIMITS.codePoints ||
    !Array.isArray(result.segments) ||
    result.segments.length === 0 ||
    result.segments.length > FILE_LIMITS.codePoints
  )
    throw new FileError("parser_failed");
  let count = 0;
  for (const segment of result.segments) {
    if (
      segment == null ||
      typeof segment.text !== "string" ||
      !segment.text.trim() ||
      !Array.isArray(segment.headingPath) ||
      segment.headingPath.length > 6 ||
      !segment.headingPath.every((heading) => typeof heading === "string") ||
      segment.location == null ||
      typeof segment.location !== "object"
    )
      throw new FileError("parser_failed");
    count += boundedCodePoints(segment.text);
    if (count > FILE_LIMITS.codePoints) throw new FileError("parser_failed");
    const keys = Object.keys(segment.location).sort().join(",");
    const positive = (v: unknown): v is number =>
      Number.isSafeInteger(v) && Number(v) >= 1;
    if (format === "pdf") {
      if (keys !== "page" || !positive(segment.location.page))
        throw new FileError("parser_failed");
    } else if (format === "docx") {
      if (keys !== "paragraph" || !positive(segment.location.paragraph))
        throw new FileError("parser_failed");
    } else if (
      keys !== "lineEnd,lineStart" ||
      !positive(segment.location.lineStart) ||
      !positive(segment.location.lineEnd) ||
      segment.location.lineEnd < segment.location.lineStart
    )
      throw new FileError("parser_failed");
  }
  if (count !== result.codePoints) throw new FileError("parser_failed");
}

// Count Unicode scalars without allocating a potentially 20 MiB array of characters.
export function boundedCodePoints(text: string): number {
  let count = 0;
  for (let offset = 0; offset < text.length; ) {
    offset += (text.codePointAt(offset) ?? 0) > 0xffff ? 2 : 1;
    if (++count > FILE_LIMITS.codePoints)
      throw new FileError("extraction_limit");
  }
  return count;
}
