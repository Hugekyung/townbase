import { createHash } from "node:crypto";

export const PRICE_VERSION = "openai-global-standard-2026-10-26";
export const ANSWER_MODELS = ["gpt-6-luna", "gpt-6.1-sol"] as const;
export type AnswerModel = (typeof ANSWER_MODELS)[number];
export type Reasoning = "none" | "low" | "medium" | "high" | "xhigh" | "max";
export const DEFAULT_EXECUTION = Object.freeze({
  answerModel: "gpt-6-luna" as AnswerModel,
  reasoning: "low" as Reasoning,
  inputTokenLimit: 16000,
  outputTokenLimit: 4096,
  monthlyBudgetUsd: null as string | null,
  priceVersion: null as string | null,
});
export class ModelCallError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
  ) {
    super(code);
  }
}
export type ExecutionSettings = {
  answerModel: AnswerModel;
  reasoning: Reasoning;
  inputTokenLimit: number;
  outputTokenLimit: number;
  monthlyBudgetUsd: string | null;
  priceVersion: string | null;
};
export function parseBudget(value: unknown): bigint | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9][0-9]{0,4})(?:\.[0-9]{1,2})?$/.test(value)
  )
    throw new ModelCallError("invalid_budget");
  const [whole, cents = ""] = value.split(".");
  const result =
    BigInt(whole!) * 1000000000n + BigInt(cents.padEnd(2, "0")) * 10000000n;
  if (result <= 0n) throw new ModelCallError("invalid_budget");
  return result;
}
export function usd(nano: bigint): string {
  return `${nano / 1000000000n}.${(nano % 1000000000n).toString().padStart(9, "0")}`;
}
export function validExecution(value: unknown): value is ExecutionSettings {
  if (value == null || typeof value !== "object" || Array.isArray(value))
    return false;
  const v = value as ExecutionSettings;
  return (
    (v.monthlyBudgetUsd === null || typeof v.monthlyBudgetUsd === "string") &&
    ANSWER_MODELS.includes(v.answerModel) &&
    ["none", "low", "medium", "high", "xhigh", "max"].includes(v.reasoning) &&
    !(v.answerModel === "gpt-6.1-sol" && v.reasoning === "none") &&
    Number.isInteger(v.inputTokenLimit) &&
    v.inputTokenLimit >= 512 &&
    v.inputTokenLimit <= 16000 &&
    Number.isInteger(v.outputTokenLimit) &&
    v.outputTokenLimit >= 128 &&
    v.outputTokenLimit <= 4096 &&
    (v.priceVersion === null || v.priceVersion === PRICE_VERSION)
  );
}
// Integer nanoUSD/token. Cache writes replace the ordinary input rate.
export function rates(model: string) {
  if (model === "gpt-6-luna")
    return {
      input: 100n,
      cached: 10n,
      write30: 125n,
      write12: 250n,
      output: 500n,
    };
  if (model === "gpt-6.1-sol")
    return {
      input: 2000n,
      cached: 100n,
      write30: 2500n,
      write12: 5000n,
      output: 10000n,
    };
  if (model === "text-embedding-3-small")
    return { input: 20n, cached: 20n, write30: 20n, write12: 20n, output: 0n };
  throw new ModelCallError("unsupported_model");
}
export type Usage = {
  input: number;
  cached: number;
  write30: number;
  write12: number;
  output: number;
  reasoning: number;
};
export function cost(model: string, usage: Usage): bigint {
  const r = rates(model);
  return (
    BigInt(usage.input - usage.cached - usage.write30 - usage.write12) *
      r.input +
    BigInt(usage.cached) * r.cached +
    BigInt(usage.write30) * r.write30 +
    BigInt(usage.write12) * r.write12 +
    BigInt(usage.output) * r.output
  );
}
export function reservation(
  model: string,
  input: number,
  output: number,
): bigint {
  const r = rates(model);
  // Reserve for the most expensive cache lifetime even though requests use 30m.
  return BigInt(input) * r.write12 + BigInt(output) * r.output;
}
export function digest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
export function validRequestId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value,
    )
  );
}
// Conservative byte bound for the single text input, plus message framing.
// This is not the legacy whitespace tokenizer or a claim of exact API tokens.
export function inputBound(input: string): number {
  return Buffer.byteLength(input, "utf8") + 256;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value != null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
