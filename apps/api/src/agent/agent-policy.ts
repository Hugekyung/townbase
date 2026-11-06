import type { BasicAgentConfiguration } from "@townbase/agent-core";
import { fields } from "../auth/auth-policy";
import { validRequestId } from "../model-integration/model-policy";

export const AGENT_FIELDS = [
  "name",
  "purpose",
  "instructions",
  "terminology",
  "sourceSelection",
  "sourceOriginalIds",
];
export const AGENT_LIMITS = Object.freeze({
  name: 128,
  purpose: 512,
  instructions: 2000,
  terms: 30,
  term: 64,
  meaning: 256,
  selectedSources: 200,
});
function text(value: unknown, max: number, required = true): value is string {
  return (
    typeof value === "string" &&
    value.length <= max * 2 &&
    Buffer.from(value, "utf8").toString("utf8") === value &&
    !value.includes("\u0000") &&
    Array.from(value).length <= max &&
    (!required || value.trim().length > 0)
  );
}
export function validAgentConfiguration(
  value: unknown,
): value is BasicAgentConfiguration {
  if (
    !fields(value, AGENT_FIELDS) ||
    !text(value.name, AGENT_LIMITS.name) ||
    !text(value.purpose, AGENT_LIMITS.purpose) ||
    !text(value.instructions, AGENT_LIMITS.instructions, false) ||
    !["all", "selected"].includes(value.sourceSelection as string) ||
    !Array.isArray(value.sourceOriginalIds) ||
    value.sourceOriginalIds.length > AGENT_LIMITS.selectedSources ||
    Object.keys(value.sourceOriginalIds).length !==
      value.sourceOriginalIds.length ||
    !Array.from(value.sourceOriginalIds).every(validRequestId) ||
    new Set(value.sourceOriginalIds.map((id: string) => id.toLowerCase()))
      .size !== value.sourceOriginalIds.length ||
    (value.sourceSelection === "all" && value.sourceOriginalIds.length !== 0) ||
    !Array.isArray(value.terminology) ||
    value.terminology.length > AGENT_LIMITS.terms ||
    Object.keys(value.terminology).length !== value.terminology.length ||
    !Array.from(value.terminology).every(
      (item: unknown) =>
        fields(item, ["term", "meaning"]) &&
        text(item.term, AGENT_LIMITS.term) &&
        text(item.meaning, AGENT_LIMITS.meaning),
    )
  )
    return false;
  return (
    new Set(
      value.terminology.map((item: { term: string }) =>
        item.term.trim().toLowerCase(),
      ),
    ).size === value.terminology.length
  );
}
export function canonicalAgent(
  value: BasicAgentConfiguration,
): BasicAgentConfiguration {
  const common = {
    name: value.name,
    purpose: value.purpose,
    instructions: value.instructions,
    terminology: value.terminology.map(({ term, meaning }) => ({
      term,
      meaning,
    })),
  };
  if (value.sourceSelection === "all")
    return { ...common, sourceSelection: "all", sourceOriginalIds: [] };
  return {
    ...common,
    sourceSelection: "selected",
    sourceOriginalIds: value.sourceOriginalIds
      .map((id) => id.toLowerCase())
      .sort(),
  };
}
