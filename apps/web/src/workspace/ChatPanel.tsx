import { modelSetupSteps } from "./model-readiness";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  api,
  encodedFile,
  rememberRequest,
  errorText,
  ApiError,
  download,
} from "../api";
import type { Work } from "../Workspace";
import type { Result, Integration, AnswerOptions, Source } from "./types";
import type { ChatLocation } from "./navigation";
import { Icon } from "./Icon";
// Stored locations are per extracted line (one entry per chunk line), so many
// share a page. Show each distinct place once, in source order.
export function locationLabels(
  locations: Source["locations"] | undefined,
): string {
  const labels = (locations ?? []).map(({ location: l }) =>
    l.page
      ? `${l.page}쪽`
      : l.paragraph
        ? `${l.paragraph}번째 문단`
        : `${l.lineStart ?? ""}~${l.lineEnd ?? ""}줄`,
  );
  return labels.filter((l, i) => labels.indexOf(l) === i).join(" · ");
}
export function ResultView({ result }: { result: Result }) {
  const [error, setError] = useState("");
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const citationPanel = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (sourcesOpen)
      citationPanel.current?.scrollIntoView({ block: "nearest" });
  }, [sourcesOpen]);
  const parts = (result.answer ?? "").split(
    /(\[[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\])/gi,
  );
  const copyText = parts
    .map((p) => {
      const i =
        result.sources?.findIndex(
          (s) => p.toLowerCase() === `[${s.id}]`.toLowerCase(),
        ) ?? -1;
      return i < 0 ? p : `[출처 ${i + 1}: ${result.sources[i]!.title}]`;
    })
    .join("");
  const claims = result.result
    ? [...result.result.claims, ...result.result.conflicts]
    : [];
  // A refusal that keeps verified facts is still a refusal, never an answer.
  const partial =
    result.status === "refused" &&
    result.sourceState !== "unavailable" &&
    result.result?.contractVersion === 2 &&
    result.result.claims.length > 0;
  return (
    <div className="assistant-answer">
      {partial && <span className="tag partial-badge">일부 근거만 확인</span>}
      {result.sourceState === "unavailable" ? (
        <p className="muted">
          근거 문서가 삭제·교체·제외되어 이 답변을 숨겼어요.
        </p>
      ) : result.answer ? (
        <div className="answer-text">
          {parts.map((part, n) => {
            const i =
              result.sources?.findIndex(
                (s) => part.toLowerCase() === `[${s.id}]`.toLowerCase(),
              ) ?? -1;
            return i < 0 ? (
              part
            ) : (
              <button
                type="button"
                key={n}
                className="inline-citation"
                aria-label={`출처 ${i + 1} 보기`}
                onClick={() => setSourcesOpen(true)}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="muted">
          {result.status === "running"
            ? "문서를 확인하고 있어요…"
            : result.status === "interrupted"
              ? "답변 표시를 중지했어요. 이미 전송된 요청에는 비용이 발생할 수 있어요."
              : result.errorCode
                ? errorText(new ApiError(400, result.errorCode))
                : "저장된 답변이 없어요."}
        </p>
      )}
      {result.status === "refused" && !!result.result?.conflicts.length && (
        <p className="answer-guidance">
          기준이 서로 달라요. 적용할 기준은 문서 담당자에게 확인해 주세요.
        </p>
      )}
      {partial && (
        <p className="answer-guidance">
          찾은 근거로 일부만 확인했어요. 최종 판단 전에 추가로 확인할 항목을
          살펴봐 주세요.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="answer-actions">
        {result.answer && (
          <button
            className="quiet-button"
            onClick={() =>
              void navigator.clipboard
                .writeText(copyText)
                .catch(() => setError("답변을 복사하지 못했어요."))
            }
          >
            답변 복사
          </button>
        )}
        {result.sources?.length > 0 && (
          <details
            ref={citationPanel}
            className="citation-details"
            open={sourcesOpen}
            onToggle={(e) => setSourcesOpen(e.currentTarget.open)}
          >
            <summary>출처 {result.sources.length}개</summary>
            <div className="citation-popover">
              {result.sources.map((s, i) => (
                <article key={s.id}>
                  <span className="tag">
                    {s.kind === "attachment" ? "첨부" : "등록 문서"} {i + 1}
                  </span>
                  <strong>
                    {s.promptLabel ? s.promptLabel + " · " : ""}
                    {s.title}
                  </strong>
                  <small>
                    {locationLabels(s.locations)}
                  </small>
                  {claims
                    .flatMap((c) =>
                      c.evidence
                        .filter((e) => e.sourceId === s.id)
                        .map((e) => e.quote),
                    )
                    .filter((q, j, all) => all.indexOf(q) === j)
                    .map((q, j) => (
                      <blockquote key={j}>{q}</blockquote>
                    ))}
                  {s.reference?.startsWith("/files/") && (
                    <button
                      className="quiet-button"
                      onClick={() =>
                        void download(
                          s.reference!,
                          s.fileName ?? s.title,
                        ).catch((e) => setError(errorText(e)))
                      }
                    >
                      원본 다운로드
                    </button>
                  )}
                </article>
              ))}
            </div>
          </details>
        )}
        <details className="usage-details">
          <summary>사용량</summary>
          <div>
            {result.model ?? "답변 모델 미호출"}
            {result.calls?.map((c, i) => (
              <p key={i}>
                {c.model} · {c.status} · US$
                {c.chargedUsd ??
                  (c.chargedNanoUsd == null
                    ? "미확정"
                    : (Number(c.chargedNanoUsd) / 1e9).toFixed(9))}
                <small>usage {JSON.stringify(c.usage)}</small>
              </p>
            ))}
            <small>
              요청 {result.requestId}
              {result.errorCode ? " · " + result.errorCode : ""}
            </small>
          </div>
        </details>
      </div>
    </div>
  );
}
export function ChatPanel({
  work,
  location,
  name,
  onSaved,
  onNavigate,
  onNew,
  onMessage,
}: {
  work: Work;
  location: ChatLocation;
  name: string;
  onSaved(kind: "rag" | "attachment", id: string): void;
  onNavigate(hash: string): void;
  onNew(kind?: "rag" | "attachment"): void;
  onMessage(message: string): void;
}) {
  const [results, setResults] = useState<Result[]>([]),
    [loading, setLoading] = useState(!!location.id),
    [loadError, setLoadError] = useState(""),
    [loadAttempt, setLoadAttempt] = useState(0),
    [cursor, setCursor] = useState<string | null>(null),
    [question, setQuestion] = useState(""),
    [mode, setMode] = useState("auto"),
    [files, setFiles] = useState<File[]>([]),
    [ids, setIds] = useState<string[]>([]),
    [available, setAvailable] = useState<
      { id: string; fileName: string; available: boolean }[]
    >([]),
    [operation, setOperation] = useState("summary"),
    [mixed, setMixed] = useState(false),
    [searchQuestion, setSearchQuestion] = useState(""),
    [pending, setPending] = useState<{
      id: string;
      question: string;
      kind: "rag" | "attachment";
    } | null>(null),
    [uncertain, setUncertain] = useState(false),
    [uncertainRequest, setUncertainRequest] = useState<{
      kind: "rag" | "attachment";
      id: string;
    } | null>(null),
    [stopping, setStopping] = useState(false),
    [referenceHistory, setReferenceHistory] = useState(true);
  const [integration, setIntegration] = useState<Integration | null>(null);
  const [modelOptions, setModelOptions] = useState<AnswerOptions | null>(null);
  const [modelError, setModelError] = useState("");
  const [modelLoading, setModelLoading] = useState(true);
  const [modelAttempt, setModelAttempt] = useState(0);
  const [agentConfigured, setAgentConfigured] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    setModelError("");
    setModelLoading(true);
    void Promise.all([
      api<Integration>(
        "/settings/model-integration",
        "GET",
        undefined,
        {},
        c.signal,
      ),
      api<{ agent: unknown }>(
        "/settings/agent",
        "GET",
        undefined,
        {},
        c.signal,
      ),
    ])
      .then(([value, a]) => {
        if (c.signal.aborted) return;
        setIntegration(value);
        setAgentConfigured(a.agent != null);
        setModelOptions(
          (current) =>
            current ?? {
              answerModel: value.execution.settings.answerModel,
              reasoning: value.execution.settings.reasoning,
            },
        );
      })
      .catch((e) => {
        if (!c.signal.aborted) {
          setIntegration(null);
          setModelError(errorText(e));
        }
      })
      .finally(() => {
        if (!c.signal.aborted) setModelLoading(false);
      });
    return () => c.abort();
  }, [work.refresh, modelAttempt]);
  const scrollArea = useRef<HTMLDivElement>(null),
    scrollAnchor = useRef<{ height: number; top: number } | null>(null),
    nearBottom = useRef(true);
  const end = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    fileInput = useRef<HTMLInputElement>(null),
    alive = useRef(true);
  const privateMode =
    location.kind === "attachment" || files.length > 0 || ids.length > 0;
  const previousPrivate = useRef(privateMode);
  useEffect(() => {
    if (previousPrivate.current && !privateMode) {
      setQuestion("");
      setSearchQuestion("");
      setMixed(false);
    }
    previousPrivate.current = privateMode;
  }, [privateMode]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const c = new AbortController();
    setLoadError("");
    if (location.id) {
      setLoading(true);
      void (
        location.kind === "rag"
          ? api<{ turns: Result[]; nextCursor: string | null }>(
              `/rag/conversations/${location.id}/turns?order=latest`,
              "GET",
              undefined,
              {},
              c.signal,
            ).then((r) => {
              setResults(r.turns);
              const latest = r.turns.at(-1)?.modelOptions;
              if (latest) setModelOptions(latest);
              setCursor(r.nextCursor);
            })
          : api<Result>(
              "/attachment-tasks/" + location.id,
              "GET",
              undefined,
              {},
              c.signal,
            ).then((r) => {
              setResults([r]);
              if (r.modelOptions) setModelOptions(r.modelOptions);
            })
      )
        .catch((e) => {
          if (!c.signal.aborted) setLoadError(errorText(e));
        })
        .finally(() => {
          if (!c.signal.aborted) setLoading(false);
        });
    }
    return () => c.abort();
  }, [location.id, location.kind, loadAttempt]);
  useEffect(() => {
    if (!privateMode) return;
    const c = new AbortController();
    void api<{
      attachments: { id: string; fileName: string; available: boolean }[];
    }>("/attachments", "GET", undefined, {}, c.signal)
      .then((r) => {
        setAvailable(r.attachments);
        setIds((old) =>
          old.filter((id) =>
            r.attachments.some((f) => f.id === id && f.available),
          ),
        );
      })
      .catch((e) => {
        if (!c.signal.aborted) setLoadError(errorText(e));
      });
    return () => c.abort();
  }, [privateMode, work.refresh]);
  useLayoutEffect(() => {
    if (loading) return;
    const area = scrollArea.current,
      anchor = scrollAnchor.current;
    if (area && anchor) {
      area.scrollTop = area.scrollHeight - anchor.height + anchor.top;
      scrollAnchor.current = null;
    } else if (nearBottom.current)
      end.current?.scrollIntoView({ block: "end" });
  }, [loading, results, pending?.id]);

  const put = (r: Result) =>
    setResults((old) =>
      [...old.filter((x) => x.requestId !== r.requestId), r].sort((a, b) =>
        (a.createdAt ?? "").localeCompare(b.createdAt ?? ""),
      ),
    );
  const currentRunning = results.find((r) => r.status === "running");
  useEffect(() => {
    if (!currentRunning) return;
    const c = new AbortController();
    let reading = false;
    const timer = setInterval(() => {
      if (reading) return;
      reading = true;
      void api<Result>(
        (location.kind === "rag" ? "/rag/questions/" : "/attachment-tasks/") +
          currentRunning.requestId,
        "GET",
        undefined,
        {},
        c.signal,
      )
        .then(put)
        .catch((e) => {
          if (!c.signal.aborted) setLoadError(errorText(e));
        })
        .finally(() => {
          reading = false;
        });
    }, 2000);
    return () => {
      clearInterval(timer);
      c.abort();
    };
  }, [currentRunning?.requestId, location.kind]);
  function chooseFiles(incoming: File[]) {
    if (incoming.length > 3) {
      onMessage("첨부는 한 번에 최대3개까지 선택해 주세요.");
      return;
    }
    setFiles(incoming);
    setIds([]);
    setLoadError("");
  }
  async function readPending() {
    // A private attachment sent from a RAG route still belongs to attachment.
    const saved = uncertainRequest;
    if (!saved || !["rag", "attachment"].includes(saved.kind)) return;
    await work.run(async () => {
      const r = await api<Result>(
        (saved.kind === "rag" ? "/rag/questions/" : "/attachment-tasks/") +
          saved.id,
      );
      put(r);
      setUncertain(false);
      setUncertainRequest(null);
      onSaved(
        saved.kind as "rag" | "attachment",
        r.conversationId ?? r.requestId,
      );
    });
  }
  async function stop() {
    const id = pending?.id ?? currentRunning?.requestId;
    if (!id || stopping) return;
    setStopping(true);
    try {
      const r = await api<Result>(
        ((pending?.kind ?? location.kind) === "attachment"
          ? "/attachment-tasks/"
          : "/rag/questions/") +
          id +
          "/stop",
        "POST",
        {},
      );
      if (alive.current) {
        put(r);
        setPending(null);
        setUncertain(false);
      }
    } catch (e) {
      if (alive.current) onMessage(errorText(e));
    } finally {
      if (alive.current) setStopping(false);
    }
  }
  async function send() {
    if (
      !question.trim() ||
      work.busy ||
      currentRunning ||
      !modelReady ||
      !modelOptions
    )
      return;
    const q = question;
    let requestId: string | undefined;
    setLoadError("");
    await work.run(async () => {
      try {
        let attached = [...ids];
        if (privateMode) {
          if (
            attached.length + files.length < 1 ||
            attached.length + files.length > 3
          )
            throw new ApiError(400, "attachment_count_limit");
          if (files.reduce((n, f) => n + f.size, 0) > 20 * 1024 * 1024)
            throw new ApiError(413, "file_too_large");
          if (mixed && !searchQuestion.trim())
            throw new ApiError(400, "invalid_request");
          if (
            attached.some((id) =>
              available.some((f) => f.id === id && !f.available),
            )
          )
            throw new ApiError(409, "reattach_required");
          for (const f of files) {
            if (!alive.current) return;
            const uploaded = await api<{ id: string }>(
              "/attachments",
              "POST",
              await encodedFile(f, 10 * 1024 * 1024),
            );
            attached.push(uploaded.id);
            if (alive.current) {
              setIds([...attached]);
              setFiles((old) => old.filter((x) => x !== f));
            }
          }
        }
        if (!alive.current) return;
        const preparedId = crypto.randomUUID();
        rememberRequest(privateMode ? "attachment" : "rag", preparedId);
        requestId = preparedId;
        setPending({
          id: requestId,
          question: q,
          kind: privateMode ? "attachment" : "rag",
        });
        setUncertain(false);
        setQuestion("");
        const context = (referenceHistory ? results : [])
          .filter(
            (r) =>
              ["answered", "refused"].includes(r.status) &&
              r.answer &&
              r.sourceState !== "unavailable",
          )
          .slice(-3)
          .map((r) => r.requestId);
        const response = await api<Result>(
          privateMode ? "/attachment-tasks" : "/rag/questions",
          "POST",
          privateMode
            ? {
                requestId,
                question: q,
                operation,
                modelOptions,
                attachmentIds: attached,
                requestedMode: mode,
                historyRequestIds:
                  location.kind === "attachment" ? context : [],
                ...(mixed ? { ragQuestion: searchQuestion } : {}),
              }
            : {
                requestId,
                question: q,
                requestedMode: mode,
                modelOptions,
                historyRequestIds: context,
                ...(location.id ? { conversationId: location.id } : {}),
              },
        );
        if (alive.current) {
          put(response);
          setPending(null);
          setIds([]);
          setFiles([]);
          onSaved(
            privateMode ? "attachment" : "rag",
            response.conversationId ?? response.requestId,
          );
          input.current?.focus();
        }
      } catch (e) {
        if (alive.current) {
          if (requestId) {
            setUncertainRequest({
              kind: privateMode ? "attachment" : "rag",
              id: requestId,
            });
            setUncertain(true);
          }
          setPending(null);
          setQuestion(q);
        }
        throw e;
      }
    });
  }
  const missingSetup = integration
    ? modelSetupSteps(integration, {
        privateMode,
        mixed,
        agentConfigured,
      }).filter((step) => !step.ready)
    : [];
  const modelReady =
    !modelLoading &&
    integration != null &&
    !modelError &&
    missingSetup.length === 0;
  const empty = !loading && !results.length && !pending;
  return (
    <div
      className="chat-canvas"
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (!work.busy && e.dataTransfer.files.length > 0)
          chooseFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <div className="thread-tools">
        <span>{privateMode ? "일회성 첨부 작업" : "내 문서와 대화"}</span>
        {location.id && (
          <details>
            <summary aria-label="대화 메뉴">···</summary>
            <div>
              <button
                disabled={work.busy}
                onClick={() => {
                  if (
                    !window.confirm(
                      location.kind === "rag"
                        ? "이 채팅과 관련 Knowledge Gap을 삭제할까요?"
                        : "이 첨부 작업과 결과를 삭제할까요?",
                    )
                  )
                    return;
                  void work.run(async () => {
                    await api(
                      (location.kind === "rag"
                        ? "/rag/conversations/"
                        : "/attachment-tasks/") + location.id,
                      "DELETE",
                      {},
                    );
                    onNew();
                  });
                }}
              >
                <Icon name="trash" />{" "}
                {location.kind === "rag" ? "채팅 삭제" : "첨부 결과 삭제"}
              </button>
            </div>
          </details>
        )}
      </div>
      <div
        ref={scrollArea}
        onScroll={(e) => {
          const node = e.currentTarget;
          nearBottom.current =
            node.scrollHeight - node.scrollTop - node.clientHeight < 80;
        }}
        className="thread-scroll"
        aria-label="채팅 내역"
        aria-busy={loading}
      >
        {loading && (
          <p className="thread-loading" role="status">
            채팅을 불러오고 있어요…
          </p>
        )}
        {loadError && (
          <p className="notice attention" role="alert">
            {loadError}{" "}
            <button onClick={() => setLoadAttempt((n) => n + 1)}>
              다시 불러오기
            </button>
          </p>
        )}
        {empty && (
          <div className="chat-welcome">
            <span className="welcome-mark">t</span>
            <h1>무엇이 궁금하세요?</h1>
            <p>내 문서를 바탕으로, 근거와 함께 답할게요.</p>
            <div className="welcome-prompts">
              {[
                "등록한 문서의 핵심 내용을 알려줘",
                "사용 방법을 순서대로 설명해줘",
                "문서에서 확인이 필요한 부분은 뭐야?",
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => {
                    setQuestion(q);
                    input.current?.focus();
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
            <button
              className="quiet-button"
              onClick={() => onNavigate("#/documents")}
            >
              문서를 먼저 등록하기 →
            </button>
          </div>
        )}
        {cursor && (
          <button
            className="older-messages"
            disabled={work.busy}
            onClick={() =>
              void work.run(async () => {
                const p = await api<{
                  turns: Result[];
                  nextCursor: string | null;
                }>(
                  `/rag/conversations/${location.id}/turns?order=latest&cursor=${cursor}`,
                );
                const area = scrollArea.current;
                if (area)
                  scrollAnchor.current = {
                    height: area.scrollHeight,
                    top: area.scrollTop,
                  };
                setResults((old) => [
                  ...p.turns,
                  ...old.filter(
                    (r) => !p.turns.some((v) => v.requestId === r.requestId),
                  ),
                ]);
                setCursor(p.nextCursor);
              })
            }
          >
            이전 메시지 불러오기
          </button>
        )}
        {results.map((r) => (
          <div key={r.requestId} className="message-pair">
            <div className="user-message">
              <span className="sr-only">나</span>
              <p>{r.question ?? "근거가 변경되어 질문을 숨겼어요."}</p>
            </div>
            <div className="assistant-message">
              <span className="assistant-avatar" aria-hidden="true">
                t
              </span>
              <div>
                <span className="assistant-label">{name}</span>
                <ResultView result={r} />
              </div>
            </div>
          </div>
        ))}
        {pending && !results.some((r) => r.requestId === pending.id) && (
          <div className="message-pair">
            <div className="user-message">
              <p>{pending.question}</p>
            </div>
            <div className="assistant-message" role="status">
              <span className="assistant-avatar">t</span>
              <p className="thinking">
                <span />
                문서를 확인하고 있어요…
              </p>
            </div>
          </div>
        )}
        <div ref={end} />
      </div>
      <div className="composer-dock">
        <p className="model-choice-note">
          모델·추론 강도는 다음 답변에 적용돼요. 강도가 높으면 응답 시간과
          비용이 늘어날 수 있어요.
        </p>
        {!modelReady && (
          <div className="composer-warning" role="status">
            {modelLoading
              ? "저장된 모델 설정을 확인하고 있어요."
              : modelError
                ? "모델 설정을 불러오지 못했어요. " + modelError
                : integration
                  ? "남은 설정: " +
                    missingSetup.map((step) => step.label).join(" · ")
                  : "모델 설정을 확인하지 못했어요."}
            {!modelLoading && modelError && (
              <button onClick={() => setModelAttempt((n) => n + 1)}>
                설정 다시 확인
              </button>
            )}
            <button onClick={() => onNavigate("#/settings/models")}>
              설정 완료하기
            </button>
          </div>
        )}
        {uncertain && (
          <div className="composer-warning" role="alert">
            연결이 끊겨 저장 결과를 확인하지 못했어요. 다시 보내기 전에{" "}
            <button onClick={() => void readPending()} disabled={work.busy}>
              요청 상태 확인
            </button>
          </div>
        )}
        <form
          className="chat-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          {privateMode && (
            <div className="private-context">
              <span className="tag">일회성 첨부 · RAG에 저장하지 않음</span>
              <p>
                허용한 경우에만 OpenAI로 전달해요. 원문은 작업 후 삭제하며, 다음
                작업에는 다시 첨부해 주세요.
              </p>
              {location.kind === "rag" && location.id && (
                <small>
                  첨부 작업은 별도로 저장하며, 이 RAG 대화의 문맥을 자동
                  전달하지 않아요.
                </small>
              )}
              <div className="attachment-chips">
                {files.map((f, i) => (
                  <span key={i}>
                    {f.name}
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={f.name + " 선택 취소"}
                      disabled={work.busy}
                      onClick={() =>
                        setFiles((old) => old.filter((x) => x !== f))
                      }
                    >
                      <Icon name="close" />
                    </button>
                  </span>
                ))}
                {available.map((f) => (
                  <label key={f.id}>
                    <input
                      type="checkbox"
                      checked={ids.includes(f.id)}
                      disabled={
                        work.busy ||
                        !f.available ||
                        (!ids.includes(f.id) && ids.length + files.length >= 3)
                      }
                      onChange={(e) =>
                        setIds((old) =>
                          e.target.checked
                            ? [...old, f.id]
                            : old.filter((x) => x !== f.id),
                        )
                      }
                    />
                    {f.fileName} ·{" "}
                    {f.available ? "미사용" : "사용됨·재첨부 필요"}
                  </label>
                ))}
              </div>
              <div className="attachment-options">
                <label>
                  작업
                  <select
                    value={operation}
                    disabled={work.busy}
                    onChange={(e) => setOperation(e.target.value)}
                  >
                    <option value="summary">요약</option>
                    <option value="question">질문 답변</option>
                    <option value="draft">초안 작성</option>
                  </select>
                </label>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={mixed}
                    disabled={work.busy}
                    onChange={(e) => setMixed(e.target.checked)}
                  />
                  등록 문서도 함께 검색
                </label>
              </div>
              {mixed && (
                <input
                  aria-label="등록 문서를 검색할 별도 질문"
                  placeholder="등록 문서를 검색할 별도 질문"
                  value={searchQuestion}
                  maxLength={4000}
                  onChange={(e) => setSearchQuestion(e.target.value)}
                  disabled={work.busy}
                />
              )}
            </div>
          )}
          <textarea
            ref={input}
            aria-label="메시지"
            placeholder={
              privateMode
                ? "첨부 파일로 무엇을 할까요?"
                : "문서에 관해 무엇이든 물어보세요"
            }
            value={question}
            maxLength={4000}
            disabled={work.busy || !!currentRunning}
            rows={2}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="composer-actions">
            <input
              ref={fileInput}
              type="file"
              className="sr-only"
              multiple
              accept=".pdf,.docx,.md,.txt"
              aria-label="파일 첨부"
              disabled={work.busy}
              onChange={(e) => {
                chooseFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            <div>
              <button
                type="button"
                className="icon-button"
                aria-label="파일 첨부하기"
                title="파일 첨부 · 최대3개"
                disabled={work.busy}
                onClick={() => fileInput.current?.click()}
              >
                <Icon name="attach" />
              </button>
              <select
                aria-label="검색 목적"
                value={mode}
                disabled={work.busy}
                onChange={(e) => setMode(e.target.value)}
              >
                <option value="auto">자동</option>
                <option value="onboarding">사용 방법</option>
                <option value="product_history">변경 이력</option>
                <option value="documentation_gap">문서 부족</option>
              </select>
            </div>
            <div className="composer-send-controls">
              <div className="chat-model-controls">
                <label>
                  <span className="sr-only">모델</span>
                  <select
                    aria-label="이 채팅의 답변 모델"
                    value={modelOptions?.answerModel ?? ""}
                    disabled={
                      work.busy || !!currentRunning || loading || !integration
                    }
                    onChange={(e) => {
                      const answerModel = e.target.value;
                      const allowed =
                        integration?.execution.supportedReasoning[
                          answerModel
                        ] ?? [];
                      setModelOptions({
                        answerModel,
                        reasoning: allowed.includes(
                          modelOptions?.reasoning ?? "",
                        )
                          ? modelOptions!.reasoning
                          : "low",
                      });
                    }}
                  >
                    {!integration && <option value="">설정 확인 중</option>}
                    {integration?.supportedAnswerModels.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="sr-only">추론 강도</span>
                  <select
                    aria-label="이 채팅의 추론 강도"
                    value={modelOptions?.reasoning ?? ""}
                    disabled={
                      work.busy || !!currentRunning || loading || !integration
                    }
                    onChange={(e) =>
                      setModelOptions(
                        (current) =>
                          current && { ...current, reasoning: e.target.value },
                      )
                    }
                  >
                    {!modelOptions && <option value="">설정 확인 중</option>}
                    {(
                      integration?.execution.supportedReasoning[
                        modelOptions?.answerModel ?? ""
                      ] ?? []
                    ).map((effort) => (
                      <option key={effort} value={effort}>
                        {effort}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {pending || currentRunning ? (
                <button
                  type="button"
                  className="send-button stop-button"
                  aria-label="답변 생성 중지"
                  disabled={stopping}
                  onClick={() => void stop()}
                >
                  <span />
                </button>
              ) : (
                <button
                  className="send-button"
                  aria-label="메시지 보내기"
                  disabled={
                    work.busy ||
                    !question.trim() ||
                    !modelReady ||
                    loading ||
                    (!!loadError && !!location.id)
                  }
                >
                  <Icon name="send" />
                </button>
              )}
            </div>
          </div>
        </form>
        {results.length > 0 && !(privateMode && location.kind === "rag") && (
          <label className="context-choice">
            <input
              type="checkbox"
              checked={referenceHistory}
              disabled={work.busy}
              onChange={(e) => setReferenceHistory(e.target.checked)}
            />
            이전 대화 참고 <span>최대 최근3개 답변</span>
          </label>
        )}
        <p className="composer-caption">
          {privateMode
            ? "파일당10MiB · 최대3개 · 합계20MiB. 공급자 보관 정책은 별도예요."
            : "답변은 등록 문서에서 확인해요. 이 채팅의 최근3개 답변을 문맥으로 참고해요."}
        </p>
      </div>
    </div>
  );
}
