// Fixed product schemas, never accepted from API callers. Grounding is still
// checked against current source bodies after the provider returns.
const claim = (minItems: number) => ({
  type: "object",
  properties: {
    text: { type: "string", minLength: 1, maxLength: 4000 },
    evidence: {
      type: "array",
      minItems,
      maxItems: 10,
      items: { $ref: "#/$defs/evidence" },
    },
  },
  required: ["text", "evidence"],
  additionalProperties: false,
});
const evidenceDefinition = {
  evidence: {
    type: "object",
    properties: {
      sourceId: { type: "string", pattern: "^S[1-9][0-9]*$" },
      quote: { type: "string", minLength: 1, maxLength: 1000 },
    },
    required: ["sourceId", "quote"],
    additionalProperties: false,
  },
} as const;
// v1 stays the attachment contract and the reader for stored v1 RAG rows.
export const GROUNDED_FORMAT = {
  type: "json_schema",
  name: "townbase_grounded_v1",
  strict: true,
  schema: {
    type: "object",
    properties: {
      isAnswerable: { type: "boolean" },
      reason: { type: "string", maxLength: 2000 },
      claims: { type: "array", maxItems: 20, items: claim(1) },
      conflicts: { type: "array", maxItems: 10, items: claim(2) },
    },
    required: ["isAnswerable", "reason", "claims", "conflicts"],
    additionalProperties: false,
    $defs: evidenceDefinition,
  },
} as const;
// R05 RAG-only v2: a refusal may keep verified partial claims and lists the
// missing inputs separately; since R07 an answer may also list checks left to
// the user. followUps carry no facts and no evidence.
export const RAG_FOLLOW_UP_LIMITS = Object.freeze({ items: 5, length: 300 });
export const RAG_GROUNDED_FORMAT = {
  type: "json_schema",
  name: "townbase_rag_grounded_v2",
  strict: true,
  schema: {
    type: "object",
    properties: {
      isAnswerable: { type: "boolean" },
      reason: { type: "string", maxLength: 2000 },
      claims: { type: "array", maxItems: 20, items: claim(1) },
      conflicts: { type: "array", maxItems: 10, items: claim(2) },
      followUps: {
        type: "array",
        maxItems: RAG_FOLLOW_UP_LIMITS.items,
        items: {
          type: "string",
          minLength: 1,
          maxLength: RAG_FOLLOW_UP_LIMITS.length,
        },
      },
    },
    required: ["isAnswerable", "reason", "claims", "conflicts", "followUps"],
    additionalProperties: false,
    $defs: evidenceDefinition,
  },
} as const;
export type GroundedFormat =
  | typeof GROUNDED_FORMAT
  | typeof RAG_GROUNDED_FORMAT;
export const GROUNDED_FORMAT_INPUT = JSON.stringify({
  format: GROUNDED_FORMAT,
});
export const RAG_GROUNDED_FORMAT_INPUT = JSON.stringify({
  format: RAG_GROUNDED_FORMAT,
});
// Purpose decides the schema; any other purpose sends no format at all.
export function groundedFormat(purpose: string): GroundedFormat | null {
  switch (purpose) {
    case "rag_answer":
      return RAG_GROUNDED_FORMAT;
    case "attachment_answer":
      return GROUNDED_FORMAT;
    default:
      return null;
  }
}
export function groundedFormatInput(purpose: string): string {
  const format = groundedFormat(purpose);
  return format == null ? "" : JSON.stringify({ format });
}
export const groundedPurpose = (purpose: string) =>
  groundedFormat(purpose) != null;
