import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

type Readiness = {
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
  return record as Readiness;
}

function App() {
  const [status, setStatus] = useState<Readiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timer = setTimeout(() => controller.abort(), 8000);
    setLoading(true);
    setFailed(false);
    setStatus(null);
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
    status.storage === "ready";
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
              disabled={loading}
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
                  className={`state ${loading ? "pending" : check.value === "ready" ? "ready" : "error"}`}
                >
                  {loading
                    ? "확인 중"
                    : check.value === "ready"
                      ? "연결됨"
                      : failed
                        ? "확인 불가"
                        : "연결 필요"}
                </span>
              </div>
            ))}
          </div>
          <div
            className={`notice ${!loading && !ready ? "attention" : ""}`}
            role="status"
          >
            {loading
              ? "현재 연결 상태를 확인하고 있어요."
              : failed
                ? "서버 상태를 가져오지 못했어요. 연결을 확인하고 다시 시도해 주세요."
                : ready
                  ? "기본 실행 환경이 연결됐어요. 다음은 관리자 초기 설정이에요."
                  : "연결되지 않은 항목이 있어요. 운영자가 서비스 상태를 확인해 주세요."}
          </div>
        </section>
        <section className="next-panel" aria-labelledby="next-title">
          <div className="next-icon" aria-hidden="true">
            →
          </div>
          <div>
            <span className="section-label">다음 설정</span>
            <h2 id="next-title">관리자 등록 준비 중</h2>
            <p>
              현재 버전에서는 설치 상태만 확인할 수 있어요.
              <br />
              관리자 등록·로그인·문서 등록·채팅은 아직 사용할 수 없어요.
            </p>
          </div>
          <span className="tag">아직 사용 불가</span>
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
