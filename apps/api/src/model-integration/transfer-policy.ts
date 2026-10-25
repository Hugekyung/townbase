export const FIXED_EMBEDDING = Object.freeze({
  model: "text-embedding-3-small",
  dimensions: 1536,
});
export type TransferFlags = Readonly<{
  documentEmbedding: boolean;
  rag: boolean;
  attachment: boolean;
}>;
export type TransferPurpose =
  | "document_embedding"
  | "rag_question_embedding"
  | "rag_answer"
  | "attachment_answer";
export const DEFAULT_TRANSFERS: TransferFlags = Object.freeze({
  documentEmbedding: false,
  rag: false,
  attachment: false,
});
// Built-in routes only. No custom hosts, credentials, redirects, tools or vector stores.
export const OPENAI_ENDPOINTS = Object.freeze({
  embedding: "https://api.openai.com/v1/embeddings",
  answer: "https://api.openai.com/v1/responses",
});
export class TransferDenied extends Error {
  constructor(
    readonly code:
      | "transfer_not_allowed"
      | "sensitive_content"
      | "unsupported_endpoint"
      | "invalid_transfer_input",
  ) {
    super(code);
  }
}
export function inspectTransfer(
  flags: TransferFlags,
  purpose: TransferPurpose,
  endpoint: string,
  text: string,
  fileNames: readonly string[] = [],
): void {
  let allowed: boolean, expected: string;
  switch (purpose) {
    case "document_embedding":
      allowed = flags.documentEmbedding;
      expected = OPENAI_ENDPOINTS.embedding;
      break;
    case "rag_question_embedding":
      allowed = flags.rag;
      expected = OPENAI_ENDPOINTS.embedding;
      break;
    case "rag_answer":
      allowed = flags.rag;
      expected = OPENAI_ENDPOINTS.answer;
      break;
    case "attachment_answer":
      allowed = flags.attachment;
      expected = OPENAI_ENDPOINTS.answer;
      break;
    default:
      throw new TransferDenied("invalid_transfer_input");
  }
  if (allowed !== true) throw new TransferDenied("transfer_not_allowed");
  if (endpoint !== expected) throw new TransferDenied("unsupported_endpoint");
  if (
    typeof text !== "string" ||
    !text.trim() ||
    !Array.isArray(fileNames) ||
    fileNames.some((name) => typeof name !== "string")
  )
    throw new TransferDenied("invalid_transfer_input");
  // Basic local pattern checking, not a claim of complete secret detection.
  const normalized = text.normalize("NFKC").replace(/\p{Cf}/gu, "");
  const patterns = [
    /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/i,
    /\bsk-[a-zA-Z0-9_-]{16,}/,
    /\b(?:gh[pousr]_[a-zA-Z0-9]{16,}|github_pat_[a-zA-Z0-9_]{16,})/,
    /\bxox[baprs]-[a-zA-Z0-9-]{10,}/,
    /(?:^|[\r\n])\s*(?:export\s+)?(?:[A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY))\s*=\s*\S+/im,
  ];
  if (
    patterns.some((pattern) => pattern.test(normalized)) ||
    fileNames.some((name) => {
      const base = name
        .normalize("NFKC")
        .replace(/\p{Cf}/gu, "")
        .replace(/\\/g, "/")
        .split("/")
        .at(-1)!
        .toLowerCase();
      return (
        /^(?:\.env(?:\..*)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|credentials(?:\.json)?)$/.test(
          base,
        ) || /\.(?:pem|key|p12|pfx)$/.test(base)
      );
    })
  )
    throw new TransferDenied("sensitive_content");
}
