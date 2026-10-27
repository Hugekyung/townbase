import { Injectable } from "@nestjs/common";
import { ModelCallError, type Usage, type Reasoning } from "./model-policy";
import { OPENAI_ENDPOINTS, FIXED_EMBEDDING } from "./transfer-policy";

export type ProviderRequest = {
  model: string;
  input: string;
  outputLimit: number;
  reasoning: Reasoning;
};
export type ProviderResult = {
  usage: Usage;
  providerId: string | null;
  outcome: "succeeded" | "incomplete";
  text?: string;
  embedding?: number[];
};
function object(value: unknown): Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value))
    throw new ModelCallError("invalid_provider_response", 502);
  return value as Record<string, unknown>;
}
function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new ModelCallError("invalid_usage", 502);
  return value;
}
export function parseUsage(value: unknown, embedding: boolean): Usage {
  const v = object(value);
  if (embedding) {
    const input = integer(v.prompt_tokens);
    if (integer(v.total_tokens) !== input)
      throw new ModelCallError("invalid_usage", 502);
    return {
      input,
      cached: 0,
      write30: 0,
      write12: 0,
      output: 0,
      reasoning: 0,
    };
  }
  const d = object(v.input_tokens_details),
    o = object(v.output_tokens_details);
  const write = integer(d.cache_write_tokens);
  const wd = object(d.cache_write_tokens_details);
  const usage = {
    input: integer(v.input_tokens),
    cached: integer(d.cached_tokens),
    write30: integer(wd.ttl_30m_tokens),
    write12: integer(wd.ttl_12h_tokens),
    output: integer(v.output_tokens),
    reasoning: integer(o.reasoning_tokens),
  };
  if (
    usage.write30 + usage.write12 !== write ||
    usage.cached + write > usage.input ||
    usage.reasoning > usage.output ||
    integer(v.total_tokens) !== usage.input + usage.output
  )
    throw new ModelCallError("invalid_usage", 502);
  return usage;
}
export function parseProvider(
  value: unknown,
  request: ProviderRequest,
): ProviderResult {
  const v = object(value),
    embedding = request.model === FIXED_EMBEDDING.model;
  if (v.model !== request.model)
    throw new ModelCallError("provider_model_mismatch", 502);
  const usage = parseUsage(v.usage, embedding);
  if (embedding) {
    if (!Array.isArray(v.data) || v.data.length !== 1)
      throw new ModelCallError("invalid_provider_response", 502);
    const item = object(v.data[0]);
    if (
      item.index !== 0 ||
      !Array.isArray(item.embedding) ||
      item.embedding.length !== FIXED_EMBEDDING.dimensions ||
      item.embedding.some((n) => typeof n !== "number" || !Number.isFinite(n))
    )
      throw new ModelCallError("embedding_dimension_mismatch", 502);
    return {
      usage,
      providerId: null,
      outcome: "succeeded",
      embedding: item.embedding as number[],
    };
  }
  if (
    typeof v.id !== "string" ||
    !/^[A-Za-z0-9_-]{1,200}$/.test(v.id) ||
    !["completed", "incomplete"].includes(String(v.status)) ||
    v.error != null ||
    !Array.isArray(v.output)
  )
    throw new ModelCallError("invalid_provider_response", 502);
  let text = "";
  for (const raw of v.output) {
    const item = object(raw);
    if (item.type === "reasoning") continue;
    if (
      item.type !== "message" ||
      item.role !== "assistant" ||
      !Array.isArray(item.content)
    )
      throw new ModelCallError("invalid_provider_response", 502);
    for (const rawPart of item.content) {
      const part = object(rawPart);
      if (part.type === "refusal" && typeof part.refusal === "string")
        throw new ModelCallError("provider_refusal", 422);
      if (part.type !== "output_text" || typeof part.text !== "string")
        throw new ModelCallError("invalid_provider_response", 502);
      text += part.text;
    }
  }
  if (v.status === "completed" && !text.trim())
    throw new ModelCallError("empty_provider_output", 502);
  return {
    usage,
    providerId: v.id,
    outcome: v.status === "completed" ? "succeeded" : "incomplete",
    text,
  };
}
@Injectable()
export class OpenAIProvider {
  // Injectable class can be replaced by a synthetic provider in tests; production
  // has no env switch, URL override, retry, SDK fallback or fake embeddings.
  async call(
    key: string,
    request: ProviderRequest,
    signal: AbortSignal,
  ): Promise<ProviderResult> {
    const embedding = request.model === FIXED_EMBEDDING.model;
    const response = await fetch(
      embedding ? OPENAI_ENDPOINTS.embedding : OPENAI_ENDPOINTS.answer,
      {
        method: "POST",
        redirect: "error",
        signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(
          embedding
            ? {
                model: request.model,
                input: [request.input],
                dimensions: FIXED_EMBEDDING.dimensions,
                encoding_format: "float",
              }
            : {
                model: request.model,
                input: request.input,
                max_output_tokens: request.outputLimit,
                reasoning: { effort: request.reasoning },
                store: false,
                background: false,
                stream: false,
                service_tier: "default",
                prompt_cache_options: { ttl: "30m" },
                tools: [],
              },
        ),
      },
    );
    // All post-dispatch failures are conservatively charge-unknown. Never echo
    // provider bodies or headers (which may contain prompt/credential details).
    if (!response.ok) {
      await response.body?.cancel();
      throw new ModelCallError(
        response.status === 401 || response.status === 403
          ? "provider_authentication_failed"
          : response.status === 429
            ? "provider_rate_limited"
            : "provider_unavailable",
        502,
      );
    }
    const reader = response.body?.getReader();
    if (!reader) throw new ModelCallError("invalid_provider_response", 502);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 1048576)
          throw new ModelCallError("provider_response_too_large", 502);
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    let value: unknown;
    try {
      value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new ModelCallError("invalid_provider_response", 502);
    }
    return parseProvider(value, request);
  }
}
