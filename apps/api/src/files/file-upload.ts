import { HttpException } from "@nestjs/common";
import { FILE_LIMITS, fileFormat } from "./file-contract";

export function isFileUpload(request: {
  method?: string;
  originalUrl?: string;
  url?: string;
}): boolean {
  const path = (request.originalUrl ?? request.url ?? "").split("?", 1)[0];
  return (
    (request.method === "POST" && path === "/files") ||
    (request.method === "PUT" && /^\/files\/[0-9a-f-]{36}$/i.test(path ?? ""))
  );
}
export function fileInput(body: unknown): { name: string; bytes: Buffer } {
  const invalid = (): never => {
    throw new HttpException({ code: "invalid_file_request" }, 400);
  };
  if (body == null || typeof body !== "object" || Array.isArray(body))
    return invalid();
  const value = body as Record<string, unknown>;
  if (
    Object.keys(value).sort().join(",") !== "contentBase64,name" ||
    typeof value.name !== "string" ||
    typeof value.contentBase64 !== "string"
  )
    return invalid();
  fileFormat(value.name);
  const encoded = value.contentBase64;
  if (
    encoded.length === 0 ||
    encoded.length > Math.ceil(FILE_LIMITS.bytes / 3) * 4
  )
    throw new HttpException({ code: "file_too_large" }, 413);
  // Reject permissive decoding, URL encoding, whitespace and noncanonical padding.
  // This single character-class scan avoids a huge repeated-group regexp.
  if (encoded.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(encoded))
    return invalid();
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length > FILE_LIMITS.bytes)
    throw new HttpException({ code: "file_too_large" }, 413);
  if (bytes.length === 0 || bytes.toString("base64") !== encoded)
    return invalid();
  return { name: value.name, bytes };
}
