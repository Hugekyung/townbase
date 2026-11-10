import { useEffect, useState } from "react";
import { api, errorText } from "../api";
import type { Work } from "../Workspace";
import type { Integration } from "./types";
type Group = {
  model: string;
  purpose: string;
  status: string;
  calls: string;
  measuredCalls: string;
  inputTokens: string;
  cachedTokens: string;
  outputTokens: string;
  reasoningTokens: string;
  chargedUsd: string;
  heldUsd: string;
};
type Usage = {
  start: string;
  end: string;
  timeZone: string;
  groups: Group[];
  daily: { day: string; calls: string; chargedUsd: string }[];
};
const number = (value: number | string) =>
  Number(value).toLocaleString("ko-KR");
const nano = (value: string) => {
  const [a, b = ""] = value.split(".");
  return BigInt(a!) * 1000000000n + BigInt(b.padEnd(9, "0"));
};
const money = (value: bigint) =>
  "$" +
  (value / 1000000000n).toString() +
  "." +
  (value % 1000000000n).toString().padStart(9, "0");
export function UsageDashboard({ work }: { work: Work }) {
  const [usage, setUsage] = useState<Usage | null>(null),
    [budget, setBudget] = useState<Integration["execution"] | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    setError("");
    setUsage(null);
    setBudget(null);
    void Promise.all([
      api<Usage>(
        "/settings/model-integration/usage",
        "GET",
        undefined,
        {},
        c.signal,
      ),
      api<Integration["execution"]>(
        "/settings/model-integration/execution",
        "GET",
        undefined,
        {},
        c.signal,
      ),
    ])
      .then(([u, b]) => {
        setUsage(u);
        setBudget(b);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(errorText(e));
      });
    return () => c.abort();
  }, [work.refresh]);
  const groups = usage?.groups ?? [];
  const total = (
    key:
      | "calls"
      | "measuredCalls"
      | "inputTokens"
      | "outputTokens"
      | "cachedTokens"
      | "reasoningTokens",
  ) => groups.reduce((n, g) => n + BigInt(g[key]), 0n).toString();
  const charged = groups.reduce((n, g) => n + nano(g.chargedUsd), 0n);
  return (
    <section className="usage-dashboard">
      <div className="panel-heading">
        <h2>API 사용량</h2>
        <button
          disabled={work.busy}
          onClick={() => void work.run(async () => {})}
        >
          새로고침
        </button>
      </div>
      <p className="muted">
        현재 설치에서 내 계정으로 실행한 Townbase 호출 기록이에요. OpenAI 계정
        전체 사용량이나 최종 청구서가 아니며, API Key를 교체해도 이전 기록은
        남아요.
      </p>
      {error && <p role="alert">{error}</p>}
      {!usage && !error && <p role="status">사용량을 불러오고 있어요…</p>}
      {usage && budget && (
        <>
          <p>
            {usage.start.slice(0, 10)} ~ {usage.end.slice(0, 10)} 미만 ·{" "}
            {usage.timeZone} 기준
          </p>
          <div className="usage-cards">
            <article>
              <span>호출 수</span>
              <strong>{number(total("calls"))}회</strong>
              <small>usage 확인 {number(total("measuredCalls"))}회</small>
            </article>
            <article>
              <span>입력 / 출력 토큰</span>
              <strong>
                {number(total("inputTokens"))} / {number(total("outputTokens"))}
              </strong>
              <small>
                캐시 입력 {number(total("cachedTokens"))} · 추론{" "}
                {number(total("reasoningTokens"))}
              </small>
            </article>
            <article>
              <span>이번 달 기록된 추정 비용</span>
              <strong>{money(charged)}</strong>
              <small>사용량이 확인된 호출 기준</small>
            </article>
            <article>
              <span>설치 예산 / 미확정 예약</span>
              <strong>
                {budget.settings.monthlyBudgetUsd
                  ? "$" + budget.settings.monthlyBudgetUsd
                  : "예산 미설정"}
              </strong>
              <small>예약 ${budget.heldUsd} · 이전 달 미확정 포함</small>
            </article>
          </div>
          <p
            className={
              budget.blocked || budget.warning80 ? "notice attention" : "muted"
            }
          >
            {budget.blocked
              ? "설정 또는 예산 조건으로 유료 호출이 차단된 상태예요."
              : budget.warning80
                ? "설치 예산의 80% 이상을 사용하거나 예약했어요."
                : "설정된 설치 예산 안에서 실행해요."}{" "}
            예산 차감 기준 추정 비용 ${budget.chargedUsd} + 예약 $
            {budget.heldUsd}.
          </p>
          <p className="muted">
            출력 토큰에는 추론 토큰이 포함돼요. 캐시·추론 수를 다시 더하지
            않아요. 실패·미확정 호출은 usage가 없을 수 있으며, 미확정 예약을
            실제 청구액으로 표시하지 않아요.
          </p>
          <h3>모델·용도·상태별 내역</h3>
          {!groups.length ? (
            <p>이번 달 호출 기록이 없어요.</p>
          ) : (
            <div className="usage-table">
              <table>
                <thead>
                  <tr>
                    <th>모델 / 용도</th>
                    <th>상태</th>
                    <th>호출</th>
                    <th>입력 / 출력</th>
                    <th>추정 비용</th>
                    <th>미확정 예약</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={[g.model, g.purpose, g.status].join(":")}>
                      <td>
                        {g.model}
                        <small>{g.purpose}</small>
                      </td>
                      <td>{g.status}</td>
                      <td>{number(g.calls)}</td>
                      <td>
                        {number(g.inputTokens)} / {number(g.outputTokens)}
                      </td>
                      <td>${g.chargedUsd}</td>
                      <td>${g.heldUsd}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h3>일별 사용 기록</h3>
          <div className="usage-days">
            {usage.daily.map((d) => (
              <div key={d.day}>
                <span>{d.day}</span>
                <span>{number(d.calls)}회</span>
                <span>${d.chargedUsd}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
