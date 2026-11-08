// Fixed product schema, never accepted from API callers. Grounding is still
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
    $defs: {
      evidence: {
        type: "object",
        properties: {
          sourceId: { type: "string", pattern: "^S[1-9][0-9]*$" },
          quote: { type: "string", minLength: 1, maxLength: 1000 },
        },
        required: ["sourceId", "quote"],
        additionalProperties: false,
      },
    },
  },
} as const;
export const GROUNDED_FORMAT_INPUT = JSON.stringify({
  format: GROUNDED_FORMAT,
});
export const groundedPurpose = (purpose: string) =>
  purpose === "rag_answer" || purpose === "attachment_answer";
