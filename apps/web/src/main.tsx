import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import { SetupForm } from "./SetupForm";

type Readiness = {
  setup: "required" | "complete" | "unavailable";
  database: "ready" | "unavailable";
  schema: "ready" | "unavailable";
  storage: "ready" | "unavailable";
};

function parseReadiness(value: unknown): Readiness {
  if (typeof value !== "object" || value == null)
    throw new Error("Invalid status");
  const record = value as Record<string, unknown>;
  for (const key of ["database", "schema", "storage"] as const) {
    if (record[key] !== "ready" && record[key] !== "unavailable") {
      throw new Error("Invalid status");
    }
  }
  if (!["required", "complete", "unavailable"].includes(String(record.setup)))
    throw new Error("Invalid setup status");
  return record as Readiness;
}

function App() {
  const [status, setStatus] = useState<Readiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [registering, setRegistering] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timer = setTimeout(() => controller.abort(), 8000);
    setLoading(true);
    setFailed(false);
    fetch("/readyz", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (response.status !== 200 && response.status !== 503)
          throw new Error("Status unavailable");
        return parseReadiness(await response.json());
      })
      .then((next) => {
        if (active) setStatus(next);
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        clearTimeout(timer);
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [attempt]);

  const ready =
    status?.database === "ready" &&
    status.schema === "ready" &&
    status.storage === "ready" &&
    status.setup !== "unavailable";
  const checks = [
    {
      title: "데이터베이스",
      detail: "자료와 설정을 보관할 공간",
      value: status?.database,
    },
    {
      title: "데이터 구조",
      detail: "앱에 필요한 저장 구조",
      value: status?.schema,
    },
    {
      title: "파일 저장소",
      detail: "문서와 임시 첨부의 보관 공간",
      value: status?.storage,
    },
  ];

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Townbase 설치 상태">
          <span className="brand-mark">t</span>townbase
          <span className="brand-dot">.</span>
        </a>
        <span className="header-label">내 설치 관리</span>
      </header>
      <main>
        <div className="eyebrow">
          <span /> 시작하기
        </div>
        <h1>설치 상태</h1>
        <p className="intro">
          내 자료를 연결하기 전, 기본 실행 환경을 확인해요.
        </p>
        <section className="status-panel" aria-labelledby="status-title">
          <div className="panel-heading">
            <div>
              <span className="section-label">실행 환경</span>
              <h2 id="status-title">연결 상태 확인</h2>
            </div>
            <button
              onClick={() => setAttempt((value) => value + 1)}
              disabled={loading || registering}
            >
              {loading ? "확인 중…" : "상태 다시 확인"}
            </button>
          </div>
          <div className="checks" aria-live="polite" aria-busy={loading}>
            {checks.map((check, index) => (
              <div className="check" key={check.title}>
                <span className="check-number">0{index + 1}</span>
                <div>
                  <h3>{check.title}</h3>
                  <p>{check.detail}</p>
                </div>
                <span
                  className={`state ${loading ? "pending" : !failed && check.value === "ready" ? "ready" : "error"}`}
                >
                  {loading
                    ? "확인 중"
                    : failed
                      ? "확인 불가"
                      : check.value === "ready"
                        ? "연결됨"
                        : "연결 필요"}
                </span>
              </div>
            ))}
          </div>
          <div
            className={`notice ${!loading && (!ready || failed) ? "attention" : ""}`}
            role="status"
          >
            {loading
              ? "현재 연결 상태를 확인하고 있어요."
              : failed
                ? "서버 상태를 가져오지 못했어요. 연결을 확인하고 다시 시도해 주세요."
                : status?.setup === "unavailable" &&
                    status.database === "ready" &&
                    status.schema === "ready" &&
                    status.storage === "ready"
                  ? "기본 실행 환경은 연결됐지만 관리자 초기화 상태를 확인하지 못했어요. 운영자가 초기화 저장 상태를 확인해 주세요."
                  : ready
                    ? status?.setup === "complete"
                      ? "기본 실행 환경이 연결됐고 관리자 등록도 완료됐어요."
                      : "기본 실행 환경이 연결됐어요. 다음은 관리자 초기 설정이에요."
                    : "연결되지 않은 항목이 있어요. 운영자가 서비스 상태를 확인해 주세요."}
          </div>
        </section>
        <section className="next-panel" aria-labelledby="next-title">
          <div className="next-icon" aria-hidden="true">
            →
          </div>
          <div>
            <span className="section-label">다음 설정</span>
            <h2 id="next-title">
              {status?.setup === "complete"
                ? "관리자 등록 완료"
                : "최초 관리자 등록"}
            </h2>
            {status?.setup === "required" ? (
              <SetupForm
                onRegistered={() => setAttempt((value) => value + 1)}
                onBusyChange={setRegistering}
                blocked={loading || failed || !ready}
              />
            ) : (
              <p>
                {status?.setup === "complete"
                  ? "관리자가 이미 등록되어 있어요. 추가 초기 등록은 차단됐어요. 로그인·문서 등록·채팅은 다음 단계에서 제공해요."
                  : status?.setup === "unavailable"
                    ? "관리자 초기화 상태를 확인한 뒤 등록할 수 있어요. 상태를 다시 확인해 주세요."
                    : "기본 실행 환경이 연결되면 최초 관리자 등록을 진행할 수 있어요."}
              </p>
            )}
          </div>
        </section>
        <footer>
          Townbase <span>내 자료로 만드는 나만의 지식 공간</span>
        </footer>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
