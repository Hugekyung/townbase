import { useEffect, useState } from "react";
import { api, errorText, rememberRequest } from "../api";
import type { Work } from "../Workspace";
type Run = {
  id: string;
  operation: string;
  status: string;
  errorCode: string | null;
  fileName: string;
  createdAt: string;
  completedAt: string | null;
  sourceState?: string;
  resultOriginalId?: string | null;
  retryOfId?: string | null;
};
type Gap = {
  id: string;
  question: string | null;
  reason: string | null;
  sourceState: string;
  createdAt: string;
};
type Operations = {
  version: string;
  database: string;
  schema: string;
  storage: unknown;
  retention: unknown;
  counts: Record<string, number>;
  lastBackupAt: string | null;
  deletionJournal: unknown;
};
export function RecordsPanel({ kind, work }: { kind: string; work: Work }) {
  const [runs, setRuns] = useState<Run[]>([]),
    [gaps, setGaps] = useState<Gap[]>([]),
    [operations, setOperations] = useState<Operations | null>(null),
    [cursor, setCursor] = useState<string | null>(null),
    [next, setNext] = useState<string | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    setError("");
    const query = cursor ? "?cursor=" + cursor : "";
    const load =
      kind === "runs"
        ? api<{ items: Run[]; nextCursor: string | null }>(
            "/file-runs" + query,
            "GET",
            undefined,
            {},
            c.signal,
          ).then((r) => {
            setRuns(r.items);
            setNext(r.nextCursor);
          })
        : kind === "gaps"
          ? api<{ gaps: Gap[]; nextCursor: string | null }>(
              "/rag/gaps" + query,
              "GET",
              undefined,
              {},
              c.signal,
            ).then((r) => {
              setGaps(r.gaps);
              setNext(r.nextCursor);
            })
          : api<Operations>("/operations", "GET", undefined, {}, c.signal).then(
              setOperations,
            );
    void load.catch((e) => {
      if (!c.signal.aborted) setError(errorText(e));
    });
    return () => c.abort();
  }, [kind, work.refresh, cursor]);
  return (
    <section>
      <div className="panel-heading">
        <h3>
          {kind === "runs"
            ? "수동 실행 이력"
            : kind === "gaps"
              ? "저장한 Knowledge Gap"
              : "기본 운영 상태"}
        </h3>
        <button
          disabled={work.busy}
          onClick={() => void work.run(async () => {})}
        >
          상태 새로고침
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {kind === "runs" && (
        <>
          <p className="muted">
            진행 중이던 실행은 재시작 후 중단으로 남아요. 유료 호출 상태를
            확인하고 직접 재시도해 주세요.
          </p>
          {runs.length === 0 && <p>아직 실행 이력이 없어요.</p>}
          {runs.map((r) => (
            <article className="document-card" key={r.id}>
              <h4>
                {r.fileName} · {r.operation}
              </h4>
              <p>
                {r.status} {r.errorCode && `· ${r.errorCode}`}
              </p>
              <small>
                {r.id} · {r.createdAt}
                {r.retryOfId && " · 재시도 원 실행 " + r.retryOfId}
              </small>
              <div className="button-row">
                {["failed", "interrupted"].includes(r.status) && (
                  <button
                    disabled={work.busy}
                    onClick={() =>
                      void work.run(async () => {
                        const id = crypto.randomUUID();
                        rememberRequest("file", id);
                        await api(
                          "/file-runs/" + r.id + "/retry",
                          "POST",
                          {},
                          { "X-Townbase-Request-Id": id },
                        );
                      })
                    }
                  >
                    수동 재시도
                  </button>
                )}
                {["queued", "running"].includes(r.status) && (
                  <button
                    disabled={work.busy}
                    onClick={() =>
                      void work.run(() =>
                        api("/file-runs/" + r.id + "/stop", "POST", {}),
                      )
                    }
                  >
                    중단 요청
                  </button>
                )}
              </div>
            </article>
          ))}
        </>
      )}
      {kind === "gaps" && (
        <>
          <p className="muted">
            등록 문서의 근거가 부족해 저장된 질문이에요. 첨부 작업에서는 공용
            Gap을 만들지 않아요.
          </p>
          {gaps.length === 0 && <p>저장된 Gap이 없어요.</p>}
          {gaps.map((g) => (
            <article className="document-card" key={g.id}>
              <h4>{g.question ?? "근거 문서 변경으로 내용 비공개"}</h4>
              <p>{g.reason ?? "현재 유효한 출처가 없어 내용을 숨겼어요."}</p>
              <small>{g.createdAt}</small>
              <button
                disabled={work.busy}
                onClick={() => {
                  if (window.confirm("이 Gap을 삭제할까요?"))
                    void work.run(() => api("/rag/gaps/" + g.id, "DELETE", {}));
                }}
              >
                Gap 삭제
              </button>
            </article>
          ))}
        </>
      )}
      {kind === "operations" && operations && (
        <div className="settings-card">
          <h4>설치·저장·보관</h4>
          <p>
            배포 {operations.version} · DB {operations.database} · 구조{" "}
            {operations.schema}
          </p>
          <p>
            마지막 성공 백업 {operations.lastBackupAt ?? "없음 / 확인되지 않음"}
          </p>
          <p>
            백업은 서버 운영자가 명시 실행해요. 마지막 성공 시점 이후 변경은
            별도 삭제 기록을 제외하고 복구되지 않을 수 있어요.
          </p>
          <dl>
            {Object.entries(operations.counts).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <details>
            <summary>저장 공간·보관·삭제 기록 상태</summary>
            <pre>
              {JSON.stringify(
                {
                  storage: operations.storage,
                  retention: operations.retention,
                  deletionJournal: operations.deletionJournal,
                },
                null,
                2,
              )}
            </pre>
          </details>
          <p>
            원본·대화·설정·암호화 Key를 백업하고, 복호화 master key와 삭제
            기록은 별도로 보관해 주세요. 임시 첨부 원본·추출문은 백업하지
            않아요.
          </p>
        </div>
      )}
      <div className="button-row">
        {next && <button onClick={() => setCursor(next)}>다음 목록</button>}
        {cursor && <button onClick={() => setCursor(null)}>처음 목록</button>}
      </div>
    </section>
  );
}
