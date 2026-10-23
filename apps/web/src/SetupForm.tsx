import { useEffect, useRef, useState, type FormEvent } from "react";

export function SetupForm({
  onRegistered,
  onBusyChange,
  blocked = false,
}: {
  onRegistered(): void;
  onBusyChange?(busy: boolean): void;
  blocked?: boolean;
}) {
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current || blocked) return;
    const normalizedUsername = username.trim();
    if (
      !normalizedUsername ||
      [...normalizedUsername].length > 128 ||
      /[\p{Cc}]/u.test(normalizedUsername)
    ) {
      setMessage(
        "관리자 이름은 공백만 입력할 수 없고 제어문자 없이 1~128자로 입력해 주세요.",
      );
      return;
    }
    if (password !== confirmation) {
      setMessage("비밀번호 확인이 일치하지 않아요.");
      return;
    }
    if ([...password].length < 15 || [...password].length > 128) {
      setMessage("비밀번호는 15~128자로 입력해 주세요.");
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    const timer = setTimeout(() => controller.abort(), 35000);
    setBusy(true);
    onBusyChange?.(true);
    setMessage("");
    try {
      const response = await fetch("/setup/administrator", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Townbase-Setup": "1",
        },
        body: JSON.stringify({ token, username: normalizedUsername, password }),
        signal: controller.signal,
        cache: "no-store",
      });
      if (response.status === 201 || response.status === 409) {
        onRegistered();
        return;
      }
      const messages: Record<number, string> = {
        400: "관리자 이름과 비밀번호 입력 조건을 확인해 주세요.",
        401: "초기 등록 토큰이 유효하지 않아요. 운영자에게 새 토큰을 요청해 주세요.",
        403: "등록할 수 없는 접속 주소예요. 운영자가 HTTPS와 접속 설정을 확인해 주세요.",
        429: "시도가 많아 잠시 제한됐어요. 잠시 후 다시 시도하거나 운영자에게 문의해 주세요.",
      };
      setMessage(
        messages[response.status] ??
          "등록 결과를 확인하지 못했어요. 먼저 상태를 다시 확인해 주세요.",
      );
    } catch {
      setMessage(
        "등록 결과를 확인하지 못했어요. 상태를 다시 확인한 뒤 진행해 주세요.",
      );
    } finally {
      clearTimeout(timer);
      pending.current = null;
      setToken("");
      setPassword("");
      setConfirmation("");
      setBusy(false);
      onBusyChange?.(false);
    }
  }

  return (
    <form className="setup-form" onSubmit={submit} aria-busy={busy}>
      <p>
        서버 운영자가 발급한 일회성 토큰이 필요해요. 토큰은 발급 후 60분 동안 한
        번만 사용할 수 있어요.
      </p>
      <label htmlFor="setup-token">초기 등록 토큰</label>
      <input
        id="setup-token"
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        required
        minLength={43}
        maxLength={43}
        autoComplete="off"
        spellCheck={false}
        disabled={busy || blocked}
      />
      <label htmlFor="setup-username">관리자 이름</label>
      <input
        id="setup-username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        required
        maxLength={256}
        autoComplete="username"
        disabled={busy || blocked}
      />
      <label htmlFor="setup-password">비밀번호</label>
      <input
        id="setup-password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        maxLength={256}
        autoComplete="new-password"
        aria-describedby="password-help"
        disabled={busy || blocked}
      />
      <span id="password-help" className="form-help">
        15~128자. 문자 종류를 강제로 조합하지 않아도 돼요.
      </span>
      <label htmlFor="setup-confirmation">비밀번호 확인</label>
      <input
        id="setup-confirmation"
        type="password"
        value={confirmation}
        onChange={(e) => setConfirmation(e.target.value)}
        required
        maxLength={256}
        autoComplete="new-password"
        disabled={busy || blocked}
      />
      <p className="form-message" role="alert">
        {message}
      </p>
      <button type="submit" disabled={busy || blocked}>
        {busy ? "등록 확인 중…" : "최초 관리자 등록"}
      </button>
    </form>
  );
}
