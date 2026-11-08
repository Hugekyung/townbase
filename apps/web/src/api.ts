export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
export async function api<T = Record<string, unknown>>(
  url: string,
  method = "GET",
  body?: unknown,
  headers: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, method === "GET" ? 10000 : 105000);
  try {
    const response = await fetch(url, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "X-Townbase-Auth": "1",
        ...(method === "GET" ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    if (response.status === 401)
      window.dispatchEvent(new Event("townbase:session-expired"));
    // Body transport failures must remain uncertain, never successful placeholders.
    const text = await response.text();
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(text);
    } catch {
      throw new ApiError(502, "invalid_response");
    }
    if (value == null || typeof value !== "object" || Array.isArray(value))
      throw new ApiError(502, "invalid_response");
    if (!response.ok) {
      throw new ApiError(
        response.status,
        typeof value.code === "string" ? value.code : "request_failed",
      );
    }
    const inputId =
      body != null && typeof body === "object" && "requestId" in body
        ? body.requestId
        : undefined;
    const readId =
      /\/(?:rag\/questions|attachment-tasks|file-runs\/requests|settings\/model-integration\/calls)\/([0-9a-f-]{36})(?:\/stop)?$/i.exec(
        url,
      )?.[1];
    const confirmed = headers["X-Townbase-Request-Id"] ?? inputId ?? readId;
    if (typeof confirmed === "string") confirmRequest(confirmed);
    return value as T;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
const messages: Record<string, string> = {
  pending_request_limit:
    "미확인 요청이 많아요. 저장 상태를 먼저 확인해 주세요.",
  invalid_agent_form:
    "이름128자·목적512자·지침2000자, 용어30개(용어64자·설명256자, 중복 없음) 범위를 확인해 주세요.",
  agent_source_unavailable:
    "제외되거나 변경된 문서가 있어요. 참조 문서를 다시 선택해 주세요.",
  input_limit_exceeded:
    "질문·설정·이력·근거의 합계가 모델 입력 한도를 넘었어요. 입력을 줄이거나 설정 한도를 확인해 주세요.",
  attachment_context_limit:
    "첨부 전체 내용을 입력 한도에 담을 수 없어요. 파일을 나눠 다시 첨부해 주세요.",
  transfer_not_allowed:
    "이 작업의 외부 전송이 허용되지 않았어요. 설정에서 전송 범위를 확인해 주세요.",
  invalid_model_settings:
    "답변 입력 한도는 최소 4,096이에요. 모델 설정을 확인해 주세요.",
  budget_not_configured: "월 예산을 먼저 설정해 주세요.",
  price_not_confirmed: "현재 가격표 확인이 필요해요.",
  budget_exceeded: "이번 달 비용 한도에 도달했어요.",
  reattach_required:
    "첨부가 사용됐거나 만료됐어요. 원본이 필요한 작업은 다시 첨부해 주세요.",
  sensitive_content: "비밀값으로 보이는 내용이 있어 전송을 차단했어요.",
  agent_not_configured: "먼저 기본 Agent를 저장해 주세요.",
  answer_busy: "다른 답변을 처리 중이에요.",
  question_rate_limited: "질문이 많아 잠시 제한됐어요.",
  request_id_conflict:
    "같은 요청 ID의 입력이 달라요. 기존 결과를 확인해 주세요.",
  agent_changed: "Agent 설정이 변경됐어요. 최신 설정을 확인해 주세요.",
  source_changed: "근거 문서가 변경돼 결과를 사용할 수 없어요.",
  file_count_limit: "한 번에 파일 1~20개를 선택해 주세요.",
  attachment_count_limit: "첨부는1~3개, 합계20MiB 이하여야 해요.",
  file_too_large: "파일 크기 한도를 넘었어요.",
  unsupported_format: "PDF·DOCX·MD·TXT 형식만 지원해요.",
  question_timeout:
    "처리 시간이 초과됐어요. 비용과 저장 상태를 확인한 뒤 새 작업 여부를 결정해 주세요.",
};
export function errorText(error: unknown) {
  if (error instanceof ApiError)
    return (
      messages[error.code] ??
      (error.status === 401
        ? "로그인이 만료됐어요."
        : `처리하지 못했어요. 오류 코드: ${error.code}`)
    );
  return "연결이 끊겨 처리 결과를 확인하지 못했어요. 저장 상태를 조회해 주세요. 유료 요청을 자동으로 다시 보내지 않아요.";
}
export type PendingRequest = {
  kind: "rag" | "attachment" | "file" | "model";
  id: string;
};
const requestKinds = ["rag", "attachment", "file", "model"];
export function pendingRequests(): PendingRequest[] {
  const raw = sessionStorage.getItem("townbase.pending");
  if (raw == null) return [];
  try {
    const v = JSON.parse(raw);
    const entries = Array.isArray(v) ? v : [v]; // migrate the previous single slot
    if (
      !entries.every(
        (r) =>
          r &&
          requestKinds.includes(r.kind) &&
          typeof r.id === "string" &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            r.id,
          ),
      )
    )
      throw Error();
    return entries;
  } catch {
    throw new ApiError(409, "pending_state_invalid");
  }
}
export function rememberRequest(kind: PendingRequest["kind"], id: string) {
  const entries = pendingRequests().filter((r) => r.id !== id);
  if (entries.length >= 50) throw new ApiError(409, "pending_request_limit");
  sessionStorage.setItem(
    "townbase.pending",
    JSON.stringify([...entries, { kind, id }]),
  );
}
export function confirmRequest(id: string): boolean {
  // Local bookkeeping must never turn an acknowledged server result into failure.
  // Keep malformed/unwritable state intact for an explicit recovery decision.
  try {
    const entries = pendingRequests().filter(
      (r) => r.id.toLowerCase() !== id.toLowerCase(),
    );
    if (entries.length)
      sessionStorage.setItem("townbase.pending", JSON.stringify(entries));
    else sessionStorage.removeItem("townbase.pending");
    return true;
  } catch {
    return false;
  }
}
export function pendingRequest(
  kind?: PendingRequest["kind"],
): PendingRequest | null {
  try {
    return (
      pendingRequests().find((r) => kind == null || r.kind === kind) ?? null
    );
  } catch {
    return null;
  } // malformed local state must not unmount the editor; new mutations still reject it
}
export async function encodedFile(file: File, max: number) {
  if (file.size < 1 || file.size > max)
    throw new ApiError(413, "file_too_large");
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < buffer.length; i += 32768)
    binary += String.fromCharCode(...buffer.subarray(i, i + 32768));
  return { name: file.name, contentBase64: btoa(binary) };
}

export async function download(url: string, name: string) {
  const response = await fetch(url, {
    credentials: "same-origin",
    cache: "no-store",
    headers: { "X-Townbase-Auth": "1" },
  });
  if (!response.ok) {
    if (response.status === 401)
      window.dispatchEvent(new Event("townbase:session-expired"));
    throw new ApiError(response.status, "file_unavailable");
  }
  const blob = await response.blob();
  const target = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = target;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(target), 1000);
}
