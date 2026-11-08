import { createHash } from "node:crypto";
import {
  ModelCallError,
  validRequestId,
} from "../model-integration/model-policy";
import {
  parseBasicAgentQuestion,
  type BasicAgentMode,
} from "@townbase/agent-core";
import { callId, type RagSource } from "../rag/rag-policy";
import type { FileExtraction } from "../files/file-contract";
export const ATTACHMENT_LIMITS = Object.freeze({
  bytes: 10 * 1024 * 1024,
  totalBytes: 20 * 1024 * 1024,
  files: 3,
  contextBytes: 8000,
  temporaryMs: 3600000,
  retentionMs: 30 * 86400000,
});
export type AttachmentInput = {
  requestId: string;
  question: string;
  operation: "summary" | "question" | "draft";
  attachmentIds: string[];
  historyRequestIds: string[];
  ragQuestion: string | null;
  requestedMode: BasicAgentMode;
};
export function taskInput(body: unknown): AttachmentInput {
  if (body == null || typeof body !== "object" || Array.isArray(body))
    throw new ModelCallError("invalid_request");
  const v = body as Record<string, unknown>;
  if (
    Object.keys(v).some(
      (k) =>
        ![
          "requestId",
          "question",
          "operation",
          "attachmentIds",
          "historyRequestIds",
          "ragQuestion",
          "requestedMode",
        ].includes(k),
    )
  )
    throw new ModelCallError("invalid_request");
  const base = parseBasicAgentQuestion({
    requestId: v.requestId,
    question: v.question,
    requestedMode: v.requestedMode ?? "auto",
  });
  const ids = (value: unknown, max: number, min: number) => {
    if (
      !Array.isArray(value) ||
      value.length < min ||
      value.length > max ||
      !Array.from(value).every(validRequestId)
    )
      throw new ModelCallError("invalid_request");
    const normalized = (value as string[]).map((s) => s.toLowerCase());
    if (new Set(normalized).size !== normalized.length)
      throw new ModelCallError("invalid_request");
    return normalized;
  };
  if (!["summary", "question", "draft"].includes(String(v.operation)))
    throw new ModelCallError("invalid_request");
  const ragQuestion =
    v.ragQuestion == null
      ? null
      : parseBasicAgentQuestion({
          requestId: base.requestId,
          question: v.ragQuestion,
          requestedMode: base.requestedMode,
        }).question;
  return {
    ...base,
    operation: v.operation as AttachmentInput["operation"],
    attachmentIds: ids(v.attachmentIds, 3, 1),
    historyRequestIds: ids(v.historyRequestIds ?? [], 3, 0),
    ragQuestion,
  };
}
export const attachmentCallId = (
  requestId: string,
  purpose: "embedding" | "answer",
) => callId("attachment:" + requestId, purpose);
export type AttachmentSource = RagSource & {
  kind: "attachment";
  attachmentId: string;
};
export function attachmentEvidence(
  file: { id: string; fileName: string; format: string; contentHash: string },
  extraction: FileExtraction,
): AttachmentSource[] {
  return extraction.segments.map((segment, i) => ({
    id: callId(file.id + ":" + i, "answer"),
    indexId: file.id,
    originalId: file.id,
    versionId: file.id,
    scopeRevision: 1,
    title: file.fileName,
    fileName: file.fileName,
    format: extraction.format,
    content: segment.text,
    contentHash: file.contentHash,
    chunkHash: createHash("sha256").update(segment.text).digest("hex"),
    headingPath: segment.headingPath,
    locations: [
      {
        segment: i,
        start: 0,
        end: segment.text.length,
        location: segment.location,
        headingPath: segment.headingPath,
      },
    ],
    sourceType: "uploaded_file",
    knowledgeTypes: ["unknown"],
    domainTags: [],
    status: "active",
    sourcePriority: 50,
    requestedMode: null,
    resolvedMode: null,
    reference: "attachment:" + file.id,
    score: 1,
    kind: "attachment",
    attachmentId: file.id,
  }));
}
export function isAttachmentUpload(req: {
  method?: string | undefined;
  originalUrl?: string | undefined;
  url?: string | undefined;
}) {
  return (
    req.method === "POST" &&
    (req.originalUrl ?? req.url ?? "")
      .split("?", 1)[0]
      ?.replace(/\/$/, "")
      .toLowerCase() === "/attachments"
  );
}
export function isAttachmentQuestion(req: {
  method?: string | undefined;
  originalUrl?: string | undefined;
  url?: string | undefined;
}) {
  return (
    req.method === "POST" &&
    (req.originalUrl ?? req.url ?? "")
      .split("?", 1)[0]
      ?.replace(/\/$/, "")
      .toLowerCase() === "/attachment-tasks"
  );
}
