import { useEffect, useState, useRef } from "react";
import {
  api,
  encodedFile,
  rememberRequest,
  errorText,
  ApiError,
  download,
} from "../api";
import type { Work } from "../Workspace";
import type { FileItem } from "./types";
export function DocumentsPanel({ work }: { work: Work }) {
  const uploadRequests = useRef(new WeakMap<File, Map<string, string>>());
  const [items, setItems] = useState<FileItem[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [next, setNext] = useState<string | null>(null),
    [error, setError] = useState(""),
    [files, setFiles] = useState<File[]>([]),
    [runs, setRuns] = useState<
      {
        name: string;
        runId?: string;
        status: string;
        errorCode?: string | null;
      }[]
    >([]);
  useEffect(() => {
    const c = new AbortController();
    setError("");
    void api<{ items: FileItem[]; nextCursor: string | null }>(
      "/files" + (cursor ? "?cursor=" + cursor : ""),
      "GET",
      undefined,
      {},
      c.signal,
    )
      .then((r) => {
        setItems(r.items);
        setNext(r.nextCursor);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(errorText(e));
      });
    return () => c.abort();
  }, [cursor, work.refresh]);
  async function submitFile(file: File, id?: string) {
    const encoded = await encodedFile(file, 20 * 1024 * 1024);
    const target = id ?? "upload";
    const requests =
      uploadRequests.current.get(file) ?? new Map<string, string>();
    const requestId = requests.get(target) ?? crypto.randomUUID();
    requests.set(target, requestId);
    uploadRequests.current.set(file, requests);
    rememberRequest("file", requestId);
    const r = await api<{ runId: string; status: string }>(
      id ? "/files/" + id : "/files",
      id ? "PUT" : "POST",
      encoded,
      { "X-Townbase-Request-Id": requestId },
    );
    setRuns((list) => [{ name: file.name, ...r }, ...list]);
  }
  async function action(file: FileItem, operation: "index" | "reprocess") {
    const requestId = crypto.randomUUID();
    rememberRequest("file", requestId);
    const r = await api<{ runId: string; status: string }>(
      "/files/" + file.id + "/" + operation,
      "POST",
      {},
      { "X-Townbase-Request-Id": requestId },
    );
    setRuns((list) => [{ name: file.title, ...r }, ...list]);
  }
  return (
    <section>
      <div className="panel-heading">
        <div>
          <h3>지속해서 사용하는 문서</h3>
          <p className="muted">
            등록·교체는 업로드 시점의 복사본이에요. 원본의 자동 변경은 반영되지
            않아요.
          </p>
        </div>
        <button
          disabled={work.busy}
          onClick={() => void work.run(async () => {})}
        >
          목록 새로고침
        </button>
      </div>
      <form
        className="upload-zone"
        onSubmit={(e) => {
          e.preventDefault();
          void work.run(async () => {
            if (files.length < 1 || files.length > 20)
              throw new ApiError(400, "file_count_limit");
            for (const file of files) {
              try {
                await submitFile(file);
                setFiles((remaining) =>
                  remaining.filter((item) => item !== file),
                );
              } catch (e) {
                setRuns((list) => [
                  { name: file.name, status: errorText(e) },
                  ...list,
                ]);
                throw e;
              }
            }
            setFiles([]);
          });
        }}
      >
        <label>
          문서 등록
          <input
            type="file"
            accept=".pdf,.docx,.md,.txt"
            multiple
            disabled={work.busy}
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
        </label>
        <p>
          PDF·DOCX·Markdown·TXT · 파일당20MiB · 한 번에20개. 등록 후 별도 색인이
          필요해요.
        </p>
        {files.length > 0 && (
          <p className="muted">
            아직 접수하지 못한 선택 파일:{" "}
            {files.map((file) => file.name).join(", ")}
          </p>
        )}
        <button disabled={work.busy || files.length === 0}>등록 실행</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {runs.length > 0 && (
        <div className="notice">
          <h4>이번 요청의 서버 상태</h4>
          {runs.map((r, i) => (
            <div key={i}>
              {r.name} · {r.status} {r.errorCode && `(${r.errorCode})`}
              {r.runId && (
                <button
                  disabled={work.busy}
                  onClick={() =>
                    void work.run(async () => {
                      const result = await api<{
                        status: string;
                        errorCode?: string | null;
                      }>("/file-runs/" + r.runId);
                      setRuns((prev) =>
                        prev.map((item, j) =>
                          j === i ? { ...item, ...result } : item,
                        ),
                      );
                    })
                  }
                >
                  실행 결과 조회
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {items.length === 0 ? (
        <p className="empty-state">
          등록한 문서가 없어요. 먼저 파일을 등록해 주세요.
        </p>
      ) : (
        <div className="document-list">
          {items.map((file) => (
            <article className="document-card" key={file.id}>
              <div>
                <h4>{file.title}</h4>
                <p>
                  {file.version?.format.toUpperCase()} · 버전
                  {file.version?.version} ·{" "}
                  {file.version?.searchable
                    ? "검색 가능"
                    : `검색 준비 필요 (${file.version?.indexStatus ?? "추출 전"})`}
                  {file.excludedAt && " · 검색 범위 제외"}
                </p>
                <small>문서 ID {file.id}</small>
              </div>
              <div className="button-row">
                <button
                  disabled={work.busy || !!file.excludedAt}
                  onClick={() => void work.run(() => action(file, "index"))}
                >
                  색인
                </button>
                <button
                  disabled={work.busy}
                  onClick={() => void work.run(() => action(file, "reprocess"))}
                >
                  추출 재처리
                </button>
                <label className="file-replace">
                  교체
                  <input
                    type="file"
                    accept=".pdf,.docx,.md,.txt"
                    disabled={work.busy}
                    onChange={(e) => {
                      const replacement = e.target.files?.[0];
                      e.target.value = "";
                      if (replacement)
                        void work.run(() => submitFile(replacement, file.id));
                    }}
                  />
                </label>
                <button
                  disabled={work.busy}
                  onClick={() =>
                    void work.run(() =>
                      api("/files/" + file.id + "/scope", "PUT", {
                        included: !!file.excludedAt,
                      }),
                    )
                  }
                >
                  {file.excludedAt ? "검색에 다시 포함" : "검색에서 제외"}
                </button>
                <button
                  disabled={work.busy}
                  onClick={() =>
                    void work.run(() =>
                      download(
                        "/files/" + file.id + "/reference",
                        file.version?.fileName ?? file.title,
                      ),
                    )
                  }
                >
                  원본 다운로드
                </button>
                <button
                  className="danger"
                  disabled={work.busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        "문서를 삭제하면 새 검색과 관련 과거 답변의 출처를 사용할 수 없어요. 삭제할까요?",
                      )
                    )
                      void work.run(() =>
                        api("/files/" + file.id, "DELETE", {}),
                      );
                  }}
                >
                  삭제
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      <div className="button-row">
        {next && <button onClick={() => setCursor(next)}>다음 문서</button>}
        {cursor && <button onClick={() => setCursor(null)}>처음 목록</button>}
      </div>
    </section>
  );
}
