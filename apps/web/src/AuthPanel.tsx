import { useEffect, useRef, useState, type FormEvent } from "react";

type Session = { username: string };
export function AuthPanel({
  blocked,
  onBusyChange,
}: {
  blocked: boolean;
  onBusyChange(busy: boolean): void;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState<"login" | "recovery" | "password">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    if (blocked) return;
    const controller = new AbortController();
    let active = true;
    const timer = setTimeout(() => controller.abort(), 8000);
    setChecking(true);
    setUnavailable(false);
    fetch("/auth/session", {
      headers: { "X-Townbase-Auth": "1" },
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) return null;
        if (!response.ok) throw new Error("Session unavailable");
        const data = await response.json();
        if (data.authenticated !== true || typeof data.username !== "string")
          throw new Error("Invalid session");
        return { username: data.username };
      })
      .then((value) => {
        if (active) {
          setSession(value);
          if (value == null) {
            setMode((current) => (current === "password" ? "login" : current));
            clearSecrets();
          }
        }
      })
      .catch(() => {
        if (active) setUnavailable(true);
      })
      .finally(() => {
        clearTimeout(timer);
        if (active) setChecking(false);
      });
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [blocked, attempt]);
  const disabled = blocked || checking || unavailable || busy;
  function clearSecrets() {
    setPassword("");
    setNewPassword("");
    setConfirmation("");
    setToken("");
  }
  function switchMode(next: typeof mode) {
    clearSecrets();
    setMessage("");
    setMode(next);
  }
  async function submit(event: FormEvent, logout = false) {
    event.preventDefault();
    if (disabled || pending.current) return;
    if (
      !logout &&
      mode !== "login" &&
      (newPassword !== confirmation ||
        [...newPassword].length < 15 ||
        [...newPassword].length > 128)
    ) {
      setMessage(
        "새 비밀번호는 15~128자로 입력하고 확인란에도 똑같이 입력해 주세요.",
      );
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    const timer = setTimeout(() => controller.abort(), 35000);
    setBusy(true);
    onBusyChange(true);
    setMessage("");
    const action = logout ? "logout" : mode === "recovery" ? "recover" : mode;
    const body = logout
      ? {}
      : mode === "login"
        ? { username, password }
        : mode === "password"
          ? { currentPassword: password, newPassword }
          : { token, newPassword };
    try {
      const response = await fetch(`/auth/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Townbase-Auth": "1" },
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify(body),
      });
      if (response.ok) {
        setMode("login");
        if (action !== "login") setSession(null);
        setMessage(
          action === "login"
            ? ""
            : action === "logout"
              ? "로그아웃했어요."
              : "비밀번호를 변경하고 모든 로그인을 종료했어요. 새 비밀번호로 로그인해 주세요.",
        );
      } else {
        const messages: Record<number, string> = {
          400: "입력한 값과 비밀번호 조건을 확인해 주세요.",
          401: "인증 정보가 유효하지 않거나 로그인이 만료됐어요. 다시 확인해 주세요.",
          403: "접속 주소와 HTTPS 설정을 운영자에게 확인해 주세요.",
          429: "시도가 많아 잠시 제한됐어요. 잠시 후 다시 시도해 주세요.",
        };
        setMessage(
          messages[response.status] ??
            "처리 결과를 확인하지 못했어요. 로그인 상태를 다시 확인해 주세요.",
        );
      }
    } catch {
      setMessage(
        "연결이 끊겨 결과를 확인하지 못했어요. 로그인 상태를 다시 확인해 주세요.",
      );
    } finally {
      clearTimeout(timer);
      pending.current = null;
      clearSecrets();
      setBusy(false);
      onBusyChange(false);
      setAttempt((value) => value + 1);
    }
  }
  return (
    <div className="auth-panel">
      <p role="status">
        {blocked
          ? "실행 환경을 먼저 확인해 주세요."
          : checking
            ? "로그인 상태 확인 중…"
            : unavailable
              ? "로그인 상태를 확인하지 못했어요."
              : session
                ? `${session.username} 님으로 로그인했어요. 문서 등록과 채팅은 다음 단계에서 제공해요.`
                : "관리자 계정으로 로그인해 주세요."}
      </p>
      <button
        type="button"
        disabled={busy || checking || blocked}
        onClick={() => setAttempt((value) => value + 1)}
      >
        로그인 상태 다시 확인
      </button>
      {!checking && !unavailable && !blocked && (
        <>
          {session && (
            <div className="auth-actions">
              <button
                disabled={disabled}
                onClick={() =>
                  switchMode(mode === "password" ? "login" : "password")
                }
              >
                {mode === "password" ? "변경 취소" : "비밀번호 변경"}
              </button>
              <form onSubmit={(event) => submit(event, true)}>
                <button disabled={disabled}>로그아웃</button>
              </form>
            </div>
          )}
          {(!session || mode === "password") && (
            <form
              className="setup-form"
              onSubmit={(event) => submit(event)}
              aria-busy={busy}
            >
              {mode === "login" && (
                <>
                  <label htmlFor="auth-username">관리자 이름</label>
                  <input
                    id="auth-username"
                    autoComplete="username"
                    required
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    disabled={disabled}
                  />
                </>
              )}
              {mode === "recovery" ? (
                <>
                  <p>
                    서버 운영자가 발급한 1회용 복구 토큰을 입력해 주세요. 토큰은
                    발급 후 60분 동안 유효해요.
                  </p>
                  <label htmlFor="recovery-token">복구 토큰</label>
                  <input
                    id="recovery-token"
                    type="password"
                    autoComplete="off"
                    required
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    disabled={disabled}
                  />
                </>
              ) : (
                <>
                  <label htmlFor="auth-password">
                    {mode === "password" ? "현재 비밀번호" : "비밀번호"}
                  </label>
                  <input
                    id="auth-password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    disabled={disabled}
                  />
                </>
              )}
              {mode !== "login" && (
                <>
                  <label htmlFor="new-password">새 비밀번호 · 15~128자</label>
                  <input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    disabled={disabled}
                  />
                  <label htmlFor="new-confirmation">새 비밀번호 확인</label>
                  <input
                    id="new-confirmation"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    disabled={disabled}
                  />
                </>
              )}
              <button type="submit" disabled={disabled}>
                {busy
                  ? "처리 중…"
                  : mode === "login"
                    ? "로그인"
                    : mode === "password"
                      ? "비밀번호 변경 후 로그아웃"
                      : "비밀번호 복구"}
              </button>
            </form>
          )}
          {!session && (
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                switchMode(mode === "recovery" ? "login" : "recovery")
              }
            >
              {mode === "recovery"
                ? "로그인으로 돌아가기"
                : "비밀번호를 잊었어요"}
            </button>
          )}
        </>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
