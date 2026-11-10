import { modelSetupSteps, connectionLabels } from "./model-readiness";
import { useEffect, useState } from "react";
import { api, ApiError, errorText, rememberRequest } from "../api";
import type { Work } from "../Workspace";
import type { Agent, Integration, Execution, FileItem } from "./types";
async function selectableFiles(signal: AbortSignal) {
  const items: FileItem[] = [];
  let cursor: string | null = null;
  do {
    const page: { items: FileItem[]; nextCursor: string | null } = await api<{
      items: FileItem[];
      nextCursor: string | null;
    }>(
      "/files" + (cursor ? "?cursor=" + cursor : ""),
      "GET",
      undefined,
      {},
      signal,
    );
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor && items.length < 200);
  return items.slice(0, 200);
}
export function SettingsPanel({ work }: { work: Work }) {
  const [integration, setIntegration] = useState<Integration | null>(null),
    [agent, setAgent] = useState<Agent | null>(null),
    [files, setFiles] = useState<FileItem[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [attempt, setAttempt] = useState(0),
    [agentLoaded, setAgentLoaded] = useState(false),
    [filesLoaded, setFilesLoaded] = useState(false),
    [agentError, setAgentError] = useState(""),
    [filesError, setFilesError] = useState(""),
    [agentLoading, setAgentLoading] = useState(true),
    [filesLoading, setFilesLoading] = useState(true);
  useEffect(() => {
    const c = new AbortController();
    setError("");
    setLoading(true);
    setAgentLoading(true);
    setFilesLoading(true);
    setAgentError("");
    setFilesError("");
    void api<Integration>(
      "/settings/model-integration",
      "GET",
      undefined,
      {},
      c.signal,
    )
      .then((value) => {
        if (!c.signal.aborted) setIntegration(value);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(errorText(e));
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    void api<{ agent: Agent | null }>(
      "/settings/agent",
      "GET",
      undefined,
      {},
      c.signal,
    )
      .then((value) => {
        if (!c.signal.aborted) {
          setAgent(value.agent);
          setAgentLoaded(true);
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setAgentError(errorText(e));
      })
      .finally(() => {
        if (!c.signal.aborted) setAgentLoading(false);
      });
    void selectableFiles(c.signal)
      .then((value) => {
        if (!c.signal.aborted) {
          setFiles(value);
          setFilesLoaded(true);
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setFilesError(errorText(e));
      })
      .finally(() => {
        if (!c.signal.aborted) setFilesLoading(false);
      });
    return () => c.abort();
  }, [work.refresh, attempt]);
  const retry = (
    <button
      type="button"
      disabled={work.busy || loading}
      onClick={() => setAttempt((n) => n + 1)}
    >
      설정 상태 다시 확인
    </button>
  );
  if (!integration)
    return (
      <section aria-busy={loading}>
        {error ? (
          <p role="alert">설정을 불러오지 못했어요. {error}</p>
        ) : (
          <p role="status">저장된 설정을 확인하고 있어요.</p>
        )}
        {retry}
      </section>
    );
  const steps = modelSetupSteps(integration, {
    agentConfigured: agentLoaded && agent != null,
  }).map((step) => ({
    ...step,
    unknown: step.id === "agent" && (agentLoading || Boolean(agentError)),
  }));
  const missing = steps.filter((step) => !step.ready);
  return (
    <div className="settings-grid">
      <section
        className="settings-card setup-progress"
        aria-label="문서 채팅 준비 상태"
        aria-busy={loading}
      >
        <h3>문서 채팅 준비 상태</h3>
        <p>
          {steps.some((step) => step.unknown)
            ? "일부 설정 상태를 확인 중이거나 확인하지 못했어요. 아래 항목을 확인해 주세요."
            : missing.length
              ? "Key 저장과 채팅 준비 완료는 달라요. 아래 남은 설정을 완료해 주세요."
              : "모델 실행 설정을 마쳤어요. 문서 등록·색인 후 질문해 보세요."}
        </p>
        {loading && <p role="status">저장된 설정을 다시 확인하고 있어요.</p>}
        {error && <p role="alert">최신 설정을 확인하지 못했어요. {error}</p>}
        <ul>
          {steps.map((step) => (
            <li key={step.id}>
              <span>
                {step.unknown
                  ? agentError
                    ? "확인 실패"
                    : "확인 중"
                  : step.ready
                    ? "완료"
                    : "설정 필요"}
              </span>
              <button
                type="button"
                onClick={() =>
                  document
                    .getElementById(step.section)
                    ?.scrollIntoView({ block: "start", behavior: "smooth" })
                }
              >
                {step.label}
              </button>
            </li>
          ))}
        </ul>
        {retry}
      </section>
      <section className="settings-card" id="model-credentials">
        <h3>1. OpenAI 연결·전송 허용</h3>
        <p>
          내 계정의 API Key로 사용하고 비용은 해당 계정에 청구돼요. Key 저장과
          실제 연결 성공은 별개예요.
        </p>
        {(["answer", "embedding"] as const).map((p) => (
          <KeyForm
            key={p}
            purpose={p}
            data={integration.credentials[p]}
            work={work}
            onChanged={setIntegration}
          />
        ))}
        <TransferForm
          key={JSON.stringify(integration.transfers)}
          initial={integration.transfers}
          work={work}
        />
      </section>
      <ModelForm
        key={JSON.stringify(integration.execution.settings)}
        integration={integration}
        work={work}
      />
      {agentError && (
        <p role="alert">기본 Agent 설정을 확인하지 못했어요. {agentError}</p>
      )}
      {filesError && (
        <p role="alert">참조 문서 목록을 확인하지 못했어요. {filesError}</p>
      )}
      {agentLoaded ? (
        <AgentForm
          key={(agent?.revision ?? 0) + ":" + (agent?.id ?? "new")}
          agent={agent}
          files={files}
          filesReady={filesLoaded && !filesLoading && !filesError}
          work={work}
        />
      ) : !agentError && !filesError ? (
        <p role="status">기본 Agent·참조 문서를 확인하고 있어요.</p>
      ) : null}
    </div>
  );
}
function KeyForm({
  purpose,
  data,
  work,
  onChanged,
}: {
  purpose: "answer" | "embedding";
  data: Integration["credentials"]["answer"];
  work: Work;
  onChanged(value: Integration): void;
}) {
  const [password, setPassword] = useState(""),
    [key, setKey] = useState(""),
    [message, setMessage] = useState("");
  async function mutate(
    action: () => Promise<unknown>,
    successMessage = "Key 상태 변경을 저장했어요.",
  ) {
    setMessage("");
    try {
      await action();
      setMessage(successMessage);
      try {
        onChanged(await api<Integration>("/settings/model-integration"));
      } catch {
        setMessage(
          successMessage +
            " 최신 상태를 확인하지 못했어요. ‘설정 상태 다시 확인’을 눌러 주세요.",
        );
      }
    } finally {
      setPassword("");
      setKey("");
    }
  }
  return (
    <form
      className="setup-form inset"
      onSubmit={(e) => {
        e.preventDefault();
        void work.run(() =>
          mutate(
            () =>
              api("/settings/model-integration/credentials/" + purpose, "PUT", {
                currentPassword: password,
                apiKey: key,
              }),
            "Key를 저장했어요. 연결 검사는 아직 실행하지 않았어요. 위 준비 상태에서 남은 설정을 확인해 주세요.",
          ),
        );
      }}
    >
      <h4>{purpose === "answer" ? "답변" : "임베딩"} Key</h4>
      <p>
        {data.configured ? (data.enabled ? "사용 중" : "비활성") : "미등록"} ·
        연결 상태{" "}
        {data.configured ? connectionLabels[data.connection] : "Key 미등록"} ·{" "}
        {data.masked ?? ""}
      </p>
      <label>
        새 API Key
        <input
          type="password"
          value={key}
          autoComplete="off"
          onChange={(e) => setKey(e.target.value)}
        />
      </label>
      <label>
        현재 관리자 비밀번호
        <input
          type="password"
          value={password}
          autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <div className="button-row">
        <button disabled={work.busy || !key || !password}>Key 저장·교체</button>
        <button
          disabled={work.busy || !data.enabled || !password}
          type="button"
          onClick={() =>
            void work.run(() =>
              mutate(() =>
                api(
                  "/settings/model-integration/credentials/" +
                    purpose +
                    "/disable",
                  "POST",
                  { currentPassword: password },
                ),
              ),
            )
          }
        >
          비활성화
        </button>
        <button
          disabled={work.busy || !data.configured || !password}
          type="button"
          onClick={() => {
            if (window.confirm("저장된 Key를 삭제할까요?"))
              void work.run(() =>
                mutate(() =>
                  api(
                    "/settings/model-integration/credentials/" + purpose,
                    "DELETE",
                    { currentPassword: password },
                  ),
                ),
              );
          }}
        >
          Key 삭제
        </button>
        <button
          disabled={work.busy || !data.enabled || !password}
          type="button"
          onClick={() =>
            void work.run(() =>
              mutate(async () => {
                const requestId = crypto.randomUUID();
                rememberRequest("model", requestId);
                await api(
                  "/settings/model-integration/checks/" + purpose,
                  "POST",
                  { currentPassword: password, requestId },
                );
              }),
            )
          }
        >
          유료 합성 연결 검사
        </button>
      </div>
      <p role="status">{message}</p>
      <small>
        연결 검사도 모델 호출 비용이 발생해요. 먼저 모델·가격·예산·해당 전송
        허용을 저장해 주세요.
      </small>
    </form>
  );
}
function TransferForm({
  initial,
  work,
}: {
  initial: Integration["transfers"];
  work: Work;
}) {
  const [value, setValue] = useState(initial),
    [password, setPassword] = useState("");
  return (
    <form
      id="model-transfers"
      className="setup-form inset"
      onSubmit={(e) => {
        e.preventDefault();
        void work.run(async () => {
          try {
            await api("/settings/model-integration/transfers", "PUT", {
              currentPassword: password,
              ...value,
            });
          } finally {
            setPassword("");
          }
        });
      }}
    >
      <h4>외부로 전달할 데이터</h4>
      {(
        [
          ["documentEmbedding", "등록 문서를 검색용 임베딩으로 전달"],
          ["rag", "직접 입력한 검색 질문·대화·등록 문서 근거 전달"],
          ["attachment", "일회성 첨부·관련 질문·작업 결과 전달"],
        ] as const
      ).map(([id, label]) => (
        <label className="check-label" key={id}>
          <input
            type="checkbox"
            checked={value[id]}
            onChange={(e) => setValue({ ...value, [id]: e.target.checked })}
          />
          {label}
        </label>
      ))}
      <p>
        허용하지 않은 용도는 호출 전에 차단해요. 자체 설치라도 허용한 자료는
        OpenAI로 전송돼요.
      </p>
      <label>
        현재 비밀번호
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <button disabled={work.busy || !password}>전송 허용 저장</button>
    </form>
  );
}
function ModelForm({
  integration,
  work,
}: {
  integration: Integration;
  work: Work;
}) {
  const [value, setValue] = useState<Execution>(integration.execution.settings),
    [password, setPassword] = useState(""),
    [price, setPrice] = useState(
      value.priceVersion === integration.execution.priceVersion,
    );
  return (
    <section className="settings-card" id="model-budget">
      <h3>2. 답변 모델·사용 한도</h3>
      <form
        className="setup-form"
        onSubmit={(e) => {
          e.preventDefault();
          void work.run(async () => {
            try {
              await api("/settings/model-integration/execution", "PUT", {
                ...value,
                priceVersion: price ? integration.execution.priceVersion : null,
                currentPassword: password,
              });
            } finally {
              setPassword("");
            }
          });
        }}
      >
        <label>
          답변 모델
          <select
            value={value.answerModel}
            onChange={(e) =>
              setValue({
                ...value,
                answerModel: e.target.value,
                reasoning:
                  value.reasoning === "none" && e.target.value === "gpt-6.1-sol"
                    ? "low"
                    : value.reasoning,
              })
            }
          >
            {integration.supportedAnswerModels.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label>
          추론 예산
          <select
            value={value.reasoning}
            onChange={(e) => setValue({ ...value, reasoning: e.target.value })}
          >
            {["none", "low", "medium", "high", "xhigh", "max"]
              .filter(
                (r) => r !== "none" || value.answerModel !== "gpt-6.1-sol",
              )
              .map((r) => (
                <option key={r}>{r}</option>
              ))}
          </select>
        </label>
        <div className="field-grid">
          <label>
            입력 상한
            <input
              type="number"
              min="4096"
              max="16000"
              step="1"
              value={value.inputTokenLimit}
              onChange={(e) =>
                setValue({ ...value, inputTokenLimit: Number(e.target.value) })
              }
            />
          </label>
          <label>
            출력 상한
            <input
              type="number"
              min="128"
              max="4096"
              step="1"
              value={value.outputTokenLimit}
              onChange={(e) =>
                setValue({ ...value, outputTokenLimit: Number(e.target.value) })
              }
            />
          </label>
        </div>
        <small>
          입력은 시스템 지침·질문·이력·근거를 포함하는 보수적 바이트 상한이에요.
          출력에는 공급자 기준의 추론 사용량도 포함돼요.
        </small>
        <label>
          월 사용 한도 (US$)
          <input
            type="number"
            min="0.01"
            max="99999.99"
            step="0.01"
            value={value.monthlyBudgetUsd ?? ""}
            onChange={(e) =>
              setValue({ ...value, monthlyBudgetUsd: e.target.value || null })
            }
          />
        </label>
        <p>
          미입력 상태에서는 유료 호출을 차단해요. 이번 달 비용 US$
          {integration.execution.chargedUsd} · 미확정 예약 US$
          {integration.execution.heldUsd}
          {integration.execution.warning80 && " · 80% 이상 사용"}
          {integration.execution.blocked && " · 신규 호출 차단 상태"}
        </p>
        <details>
          <summary>적용 가격표</summary>
          <p>{integration.execution.priceVersion}</p>
          {integration.execution.pricing.map((p) => (
            <p key={p.model}>
              {p.model} · 100만 토큰당{" "}
              {Object.entries(p.usdPerMillionTokens)
                .map(([k, v]) => `${k} US$${v}`)
                .join(" / ")}
            </p>
          ))}
          <p>추정 비용이며 최종 청구 금액과 다를 수 있어요.</p>
        </details>
        <label className="check-label">
          <input
            type="checkbox"
            checked={price}
            onChange={(e) => setPrice(e.target.checked)}
          />
          이 가격표와 비용 한도를 확인했어요.
        </label>
        <label>
          현재 비밀번호
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button disabled={work.busy || !password}>모델·한도 저장</button>
      </form>
      <p>
        임베딩은 {integration.embedding.model} ·{" "}
        {integration.embedding.dimensions}차원으로 고정돼요. 답변 모델 변경은
        재색인을 요구하지 않아요.
      </p>
    </section>
  );
}
function AgentForm({
  agent,
  files,
  filesReady,
  work,
}: {
  agent: Agent | null;
  files: FileItem[];
  filesReady: boolean;
  work: Work;
}) {
  const [name, setName] = useState(agent?.name ?? "기본 Agent"),
    [purpose, setPurpose] = useState(agent?.purpose ?? ""),
    [instructions, setInstructions] = useState(agent?.instructions ?? ""),
    [terms, setTerms] = useState(
      agent?.terminology.map((t) => t.term + "=" + t.meaning).join("\n") ?? "",
    ),
    [selection, setSelection] = useState(agent?.sourceSelection ?? "all"),
    [ids, setIds] = useState(agent?.sourceOriginalIds ?? []),
    [password, setPassword] = useState("");
  return (
    <section className="settings-card">
      <h3 id="basic-agent-settings">3. 기본 Agent</h3>
      <form
        className="setup-form"
        onSubmit={(e) => {
          e.preventDefault();
          void work.run(async () => {
            try {
              const terminology = terms
                .split("\n")
                .filter((t) => t.trim())
                .map((line) => {
                  const i = line.indexOf("=");
                  return {
                    term: i < 0 ? line : line.slice(0, i),
                    meaning: i < 0 ? "" : line.slice(i + 1),
                  };
                });
              const validText = (s: string, max: number) =>
                s.trim().length > 0 && [...s].length <= max;
              if (
                !validText(name, 128) ||
                !validText(purpose, 512) ||
                [...instructions].length > 2000 ||
                terminology.length > 30 ||
                terminology.some(
                  (t) => !validText(t.term, 64) || !validText(t.meaning, 256),
                ) ||
                new Set(terminology.map((t) => t.term.trim().toLowerCase()))
                  .size !== terminology.length
              )
                throw new ApiError(400, "invalid_agent_form");
              if (
                selection === "selected" &&
                ids.some((id) =>
                  files.some((f) => f.id === id && f.excludedAt != null),
                )
              )
                throw new ApiError(409, "agent_source_unavailable");
              await api("/settings/agent", "PUT", {
                currentPassword: password,
                expectedRevision: agent?.revision ?? 0,
                name,
                purpose,
                instructions,
                terminology,
                sourceSelection: selection,
                sourceOriginalIds: selection === "selected" ? ids : [],
              });
            } finally {
              setPassword("");
            }
          });
        }}
      >
        <label>
          이름
          <input
            required
            maxLength={128}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          목적
          <input
            required
            maxLength={512}
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
          />
        </label>
        <label>
          답변 지침
          <textarea
            value={instructions}
            maxLength={2000}
            onChange={(e) => setInstructions(e.target.value)}
          />
        </label>
        <label>
          조직 용어
          <textarea
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
            placeholder="용어=뜻 (한 줄에 하나, 최대30개)"
          />
        </label>
        <label>
          참조 문서
          <select
            disabled={!filesReady}
            value={selection}
            onChange={(e) => setSelection(e.target.value as "all" | "selected")}
          >
            <option value="all">사용 가능한 등록 문서 전체</option>
            <option value="selected">선택한 문서만</option>
          </select>
        </label>
        {!filesReady && (
          <p role="status">
            참조 문서 목록을 확인할 수 없어 선택 변경은 잠시 사용할 수 없어요.
            기존 선택은 유지돼요.
          </p>
        )}
        {selection === "selected" && (
          <fieldset disabled={!filesReady}>
            <legend>선택 {ids.length}개</legend>
            {files.map((f) => (
              <label key={f.id} className="check-label">
                <input
                  type="checkbox"
                  checked={ids.includes(f.id)}
                  disabled={f.excludedAt != null && !ids.includes(f.id)}
                  onChange={(e) =>
                    setIds(
                      e.target.checked
                        ? [...ids, f.id]
                        : ids.filter((id) => id !== f.id),
                    )
                  }
                />
                {f.title}
                {f.excludedAt != null ? " · 제외됨 (선택 해제 필요)" : ""}
              </label>
            ))}
            <small>
              최대200개 문서를 선택할 수 있어요. 기존 선택은 목록 밖에 있어도
              유지돼요.
            </small>
          </fieldset>
        )}
        <label>
          현재 비밀번호
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button disabled={work.busy || !password}>Agent 저장</button>
      </form>
    </section>
  );
}
