import { useEffect, useState, useRef, type ReactNode } from "react";
import { api, ApiError, errorText, pendingRequest } from "./api";
import { ChatPanel } from "./workspace/ChatPanel";
import { DocumentsPanel } from "./workspace/DocumentsPanel";
import { SettingsPanel } from "./workspace/SettingsPanel";
import { UsageDashboard } from "./workspace/UsageDashboard";
import { RecordsPanel } from "./workspace/RecordsPanel";
import { Icon } from "./workspace/Icon";
import { readLocation, chatHash } from "./workspace/navigation";
export type Work = {
  run<T>(action: () => Promise<T>, mutated?: boolean): Promise<T | undefined>;
  busy: boolean;
  refresh: number;
};
type ChatSummary = { id: string; title: string; updatedAt: string };
type PrivateSummary = { requestId: string; title: string; createdAt: string };
export function Workspace({
  onExpired,
  username,
  account,
}: {
  onExpired(): void;
  username: string;
  account: ReactNode;
}) {
  const [location, setLocation] = useState(readLocation),
    [desktopPinned, setDesktopPinned] = useState(() => {
      try {
        return localStorage.getItem("townbase.menu-open") === "true";
      } catch {
        return false;
      }
    }),
    [mobileMenu, setMobileMenu] = useState(false),
    [wide, setWide] = useState(
      () => window.matchMedia("(min-width: 900px)").matches,
    ),
    [version, setVersion] = useState(0),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [refresh, setRefresh] = useState(0),
    [chats, setChats] = useState<ChatSummary[]>([]),
    [privateTasks, setPrivateTasks] = useState<PrivateSummary[]>([]),
    [chatCursor, setChatCursor] = useState<string | null>(null),
    [privateCursor, setPrivateCursor] = useState<string | null>(null),
    [listError, setListError] = useState(""),
    [pending, setPending] = useState(() => pendingRequest()),
    [agent, setAgent] = useState({ name: "Townbase", model: "" });
  const menu = wide ? desktopPinned : mobileMenu;
  const setMenu = (next: boolean | ((value: boolean) => boolean)) => {
    if (wide) setDesktopPinned(next);
    else setMobileMenu(next);
  };
  const working = useRef(false),
    drawer = useRef<HTMLElement>(null),
    menuButton = useRef<HTMLButtonElement>(null);
  const expired = useRef(onExpired);
  expired.current = onExpired;
  useEffect(() => {
    const handler = () => setLocation(readLocation());
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);
  useEffect(() => {
    const handler = () => {
      sessionStorage.removeItem("townbase.pending");
      expired.current();
    };
    window.addEventListener("townbase:session-expired", handler);
    return () =>
      window.removeEventListener("townbase:session-expired", handler);
  }, []);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 900px)");
    const handler = () => {
      setMobileMenu(false);
      setWide(query.matches);
    };
    query.addEventListener("change", handler);
    return () => query.removeEventListener("change", handler);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("townbase.menu-open", String(desktopPinned));
    } catch {
      /* UI preference is optional. */
    }
  }, [desktopPinned]);
  useEffect(() => {
    if (!menu || wide) return;
    const before = document.activeElement as HTMLElement | null;
    drawer.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenu(false);
        return;
      }
      if (e.key === "Tab") {
        const nodes = drawer.current?.querySelectorAll<HTMLButtonElement>(
          "button:not(:disabled),a[href]",
        );
        if (!nodes?.length) return;
        const first = nodes[0]!,
          last = nodes[nodes.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      (before ?? menuButton.current)?.focus();
    };
  }, [menu, wide]);
  useEffect(() => {
    const c = new AbortController();
    setListError("");
    void Promise.all([
      api<{ conversations: ChatSummary[]; nextCursor: string | null }>(
        "/rag/conversations",
        "GET",
        undefined,
        {},
        c.signal,
      ),
      api<{ tasks: PrivateSummary[]; nextCursor: string | null }>(
        "/attachment-tasks?view=summary",
        "GET",
        undefined,
        {},
        c.signal,
      ),
      api<{ agent: { name: string } | null; answerModel: string }>(
        "/settings/agent",
        "GET",
        undefined,
        {},
        c.signal,
      ),
    ])
      .then(([r, p, a]) => {
        setChats(r.conversations);
        setChatCursor(r.nextCursor);
        setPrivateTasks(p.tasks);
        setPrivateCursor(p.nextCursor);
        setAgent({ name: a.agent?.name ?? "Townbase", model: a.answerModel });
      })
      .catch((e) => {
        if (!c.signal.aborted) setListError(errorText(e));
      });
    return () => c.abort();
  }, [refresh]);
  async function run<T>(action: () => Promise<T>, mutated = true) {
    if (working.current) return undefined;
    working.current = true;
    setBusy(true);
    setMessage("");
    let failed = false;
    try {
      return await action();
    } catch (e) {
      failed = true;
      if (!wide) setMenu(false);
      if (e instanceof ApiError && e.status === 401) expired.current();
      else setMessage(errorText(e));
      return undefined;
    } finally {
      working.current = false;
      setBusy(false);
      if (mutated || failed) setRefresh((n) => n + 1);
      setPending(pendingRequest());
    }
  }
  const work: Work = { run, busy, refresh };
  const go = (hash: string) => {
    if (working.current) return;
    window.location.hash = hash;
    setLocation(readLocation());
    if (!wide) setMenu(false);
    setMessage("");
  };
  const newChat = (kind: "rag" | "attachment" = "rag") => {
    setVersion((n) => n + 1);
    window.location.hash = chatHash(kind);
    setLocation(readLocation());
    if (!wide) setMenu(false);
    setMessage("");
  };
  const isChat = location.kind === "rag" || location.kind === "attachment";
  const title =
    location.kind === "rag"
      ? (chats.find((c) => c.id === location.id)?.title ?? "새 채팅")
      : location.kind === "attachment"
        ? (privateTasks.find((c) => c.requestId === location.id)?.title ??
          "첨부 작업")
        : location.kind === "documents"
          ? "문서 관리"
          : "설정";
  useEffect(() => {
    document.title = title + " · Townbase";
    return () => {
      document.title = "Townbase";
    };
  }, [title]);
  const sections = [
    ["models", "Agent·모델 연결"],
    ["account", "계정"],
    ["usage", "API 사용량"],
    ["runs", "실행 이력"],
    ["gaps", "Knowledge Gap"],
    ["operations", "운영·보관"],
  ] as const;
  return (
    <section
      className={"agent-app" + (menu && wide ? " menu-pinned" : "")}
      aria-label="Townbase Agent"
    >
      <header className="agent-header">
        <div className="agent-header-left">
          <button
            ref={menuButton}
            className="icon-button"
            aria-label={menu ? "메뉴 접기" : "메뉴 열기"}
            aria-expanded={menu}
            onClick={() => setMenu((open) => !open)}
          >
            <Icon name="menu" />
          </button>
          <button
            className="agent-name"
            disabled={busy}
            onClick={() => go("#/settings/models")}
          >
            {agent.name}
            <span>
              {agent.model ? "기본 모델 · " + agent.model : "모델 설정 확인"}
            </span>
          </button>
        </div>
        <button
          className="icon-button"
          aria-label="새 채팅"
          disabled={busy}
          onClick={() => newChat()}
        >
          <Icon name="new" />
        </button>
      </header>
      {menu && (
        <>
          {!wide && (
            <button
              className="drawer-backdrop"
              aria-label="메뉴 영역 밖 닫기"
              tabIndex={-1}
              onClick={() => setMenu(false)}
            />
          )}
          <aside
            ref={drawer}
            className="agent-drawer"
            role={wide ? "complementary" : "dialog"}
            aria-modal={wide ? undefined : true}
            aria-label="주요 메뉴와 채팅 목록"
          >
            <div className="drawer-heading">
              <a
                className="drawer-brand"
                href="#/chat"
                onClick={(e) => {
                  e.preventDefault();
                  if (!busy) newChat();
                }}
              >
                <span className="brand-mark">t</span>townbase.
              </a>
              <button
                className="icon-button"
                aria-label="메뉴 닫기"
                onClick={() => setMenu(false)}
              >
                <Icon name="close" />
              </button>
            </div>
            <button
              className="drawer-new"
              disabled={busy}
              onClick={() => newChat()}
            >
              <Icon name="new" />새 채팅
            </button>
            <nav className="drawer-tools">
              <button disabled={busy} onClick={() => go("#/documents")}>
                <Icon name="file" />
                문서 관리
              </button>
              <button disabled={busy} onClick={() => newChat("attachment")}>
                <Icon name="attach" />
                일회성 첨부 작업
              </button>
              <button disabled={busy} onClick={() => go("#/settings/models")}>
                <Icon name="settings" />
                설정
              </button>
            </nav>
            <div className="drawer-history">
              <h2>
                내 채팅 <small>30일 보관</small>
              </h2>
              {listError && <p role="alert">{listError}</p>}
              {chats.length === 0 && (
                <p className="muted">첫 대화를 시작해 보세요.</p>
              )}
              {chats.map((c) => (
                <button
                  key={c.id}
                  disabled={busy}
                  className={
                    location.kind === "rag" && location.id === c.id
                      ? "selected"
                      : ""
                  }
                  onClick={() => go(chatHash("rag", c.id))}
                >
                  <Icon name="chat" />
                  <span>{c.title || "새 채팅"}</span>
                </button>
              ))}
              {chatCursor && (
                <button
                  disabled={busy}
                  className="more-history"
                  onClick={() =>
                    void run(async () => {
                      const page = await api<{
                        conversations: ChatSummary[];
                        nextCursor: string | null;
                      }>("/rag/conversations?cursor=" + chatCursor);
                      setChats((old) => [
                        ...old,
                        ...page.conversations.filter(
                          (c) => !old.some((x) => x.id === c.id),
                        ),
                      ]);
                      setChatCursor(page.nextCursor);
                    }, false)
                  }
                >
                  이전 채팅 더 보기
                </button>
              )}
              {privateTasks.length > 0 && <h2>첨부 작업</h2>}
              {privateTasks.map((c) => (
                <button
                  key={c.requestId}
                  disabled={busy}
                  className={
                    location.kind === "attachment" &&
                    location.id === c.requestId
                      ? "selected"
                      : ""
                  }
                  onClick={() => go(chatHash("attachment", c.requestId))}
                >
                  <Icon name="attach" />
                  <span>{c.title || "첨부 작업"}</span>
                </button>
              ))}
              {privateCursor && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const p = await api<{
                        tasks: PrivateSummary[];
                        nextCursor: string | null;
                      }>(
                        "/attachment-tasks?view=summary&cursor=" +
                          privateCursor,
                      );
                      setPrivateTasks((old) => [
                        ...old,
                        ...p.tasks.filter(
                          (c) => !old.some((x) => x.requestId === c.requestId),
                        ),
                      ]);
                      setPrivateCursor(p.nextCursor);
                    }, false)
                  }
                >
                  이전 첨부 작업 더 보기
                </button>
              )}
            </div>
            <button
              className="drawer-account"
              disabled={busy}
              onClick={() => go("#/settings/account")}
            >
              <span className="account-avatar">
                {username.slice(0, 1).toUpperCase()}
              </span>
              <span>
                {username}
                <small>내 계정·설정</small>
              </span>
              <Icon name="settings" />
            </button>
          </aside>
        </>
      )}
      <div
        className={
          isChat ? "agent-page chat-page" : "agent-page management-page"
        }
      >
        {message && (
          <div className="app-notice" role="alert">
            {message}
            <button
              className="icon-button"
              aria-label="알림 닫기"
              onClick={() => setMessage("")}
            >
              <Icon name="close" />
            </button>
          </div>
        )}
        {isChat ? (
          <ChatPanel
            key={location.kind + ":" + (location.id ?? version)}
            work={work}
            location={location}
            name={agent.name}
            onSaved={(kind, id) => {
              window.location.hash = chatHash(kind, id);
            }}
            onNavigate={go}
            onNew={newChat}
            onMessage={setMessage}
          />
        ) : (
          <div className="workspace">
            <div className="management-heading">
              <button
                className="icon-button"
                aria-label="채팅으로 돌아가기"
                onClick={() => go("#/chat")}
              >
                <Icon name="arrow" />
              </button>
              <h1>{title}</h1>
            </div>
            {location.kind === "documents" ? (
              <DocumentsPanel work={work} />
            ) : (
              <div className="settings-page">
                <nav aria-label="설정 항목">
                  {sections.map(([id, label]) => (
                    <button
                      key={id}
                      aria-current={
                        location.section === id ? "page" : undefined
                      }
                      onClick={() => go("#/settings/" + id)}
                    >
                      {label}
                    </button>
                  ))}
                </nav>
                <div className="settings-content">
                  {location.section === "models" ? (
                    <SettingsPanel work={work} />
                  ) : location.section === "usage" ? (
                    <UsageDashboard work={work} />
                  ) : location.section === "account" ? (
                    <section className="settings-card">
                      <h2>관리자 계정</h2>
                      {account}
                    </section>
                  ) : (
                    <RecordsPanel
                      key={location.section}
                      kind={location.section}
                      work={work}
                    />
                  )}
                </div>
              </div>
            )}
            {pending && (
              <details className="request-status">
                <summary>미확인 요청 상태 확인</summary>
                <p>
                  연결이 끊긴 요청은 새로 실행하기 전에 저장 상태를 조회해
                  주세요.
                </p>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const base =
                        pending.kind === "rag"
                          ? "/rag/questions/"
                          : pending.kind === "attachment"
                            ? "/attachment-tasks/"
                            : pending.kind === "model"
                              ? "/settings/model-integration/calls/"
                              : "/file-runs/requests/";
                      const r = await api<{ status?: string }>(
                        base + pending.id,
                      );
                      setMessage("저장 상태: " + (r.status ?? "확인됨"));
                    })
                  }
                >
                  최근 요청 상태 조회
                </button>
              </details>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
