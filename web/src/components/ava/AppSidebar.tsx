import { useEffect, useMemo, useState, type ComponentType } from "react";
import {
  ChevronLeft,
  ChevronRight,
  History,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
} from "lucide-react";
import { fetchSessions, type SessionRow } from "../../api.js";

export interface AppSidebarItem {
  name: string;
  label: string;
  icon: ComponentType<{ size?: number | string; className?: string }>;
  onSelect: () => void;
  group: "main" | "work" | "system";
}

export interface AppSidebarProps {
  items: AppSidebarItem[];
  activeName?: string;
  visible: boolean;
  expanded: boolean;
  activeChatSessionId: string | null;
  onExpandedChange: (expanded: boolean) => void;
  onNewChat: () => void;
  onOpenCurrentChat: () => void;
  onOpenChat: (sessionId: string) => void;
  onOpenAllChats: () => void;
  onCurrentChatUnavailable?: () => void;
}

const RECENT_LIMIT = 8;

function formatRecentTime(value: number): string {
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function orderedRecent(sessions: SessionRow[], current: string | null): SessionRow[] {
  const live = sessions.filter((session) => session.status !== "deleted");
  return live
    .sort((a, b) => {
      if (a.id === current) return -1;
      if (b.id === current) return 1;
      return b.updated_at - a.updated_at;
    })
    .slice(0, RECENT_LIMIT);
}

export function AppSidebar({
  items,
  activeName,
  visible,
  expanded,
  activeChatSessionId,
  onExpandedChange,
  onNewChat,
  onOpenCurrentChat,
  onOpenChat,
  onOpenAllChats,
  onCurrentChatUnavailable,
}: AppSidebarProps) {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!expanded || !visible) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    void (async () => {
      try {
        const result = await fetchSessions();
        if (cancelled) return;
        setSessions(result);
        if (activeChatSessionId && !result.some((session) => session.id === activeChatSessionId)) {
          onCurrentChatUnavailable?.();
        }
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeChatSessionId, expanded, onCurrentChatUnavailable, visible]);

  useEffect(() => {
    if (!expanded) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onExpandedChange(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [expanded, onExpandedChange]);

  const recent = useMemo(
    () => orderedRecent(sessions, activeChatSessionId),
    [activeChatSessionId, sessions],
  );
  const grouped = {
    main: items.filter((item) => item.group === "main"),
    work: items.filter((item) => item.group === "work"),
    system: items.filter((item) => item.group === "system"),
  };

  const renderDestination = (item: AppSidebarItem) => {
    const Icon = item.icon;
    const selected = item.name === activeName;
    return (
      <button
        key={item.name}
        type="button"
        title={expanded ? undefined : item.label}
        aria-label={item.label}
        aria-current={selected ? "page" : undefined}
        onClick={item.onSelect}
        className="ava-sidebar-destination"
        data-active={selected || undefined}
      >
        <Icon size={18} className="shrink-0" />
        <span className="ava-sidebar-label">{item.label}</span>
      </button>
    );
  };

  return (
    <>
      {visible && expanded && (
        <button
          type="button"
          aria-label="Close navigation"
          className="ava-sidebar-scrim"
          onClick={() => onExpandedChange(false)}
        />
      )}
      <aside
        aria-label="AVA navigation"
        className="ava-sidebar"
        data-visible={visible || undefined}
        data-expanded={expanded || undefined}
      >
        <div className="ava-sidebar-head">
          <button
            type="button"
            className="ava-sidebar-brand"
            aria-label={expanded ? "Collapse navigation" : "Expand navigation"}
            aria-expanded={expanded}
            onClick={() => onExpandedChange(!expanded)}
          >
            <span className="ava-sidebar-mark" aria-hidden>AVA</span>
            <span className="ava-sidebar-brand-copy">
              <strong>AVA</strong>
              <small>Personal intelligence</small>
            </span>
            {expanded ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={18} />}
          </button>
        </div>

        <nav className="ava-sidebar-nav" aria-label="Primary">
          <button
            type="button"
            className="ava-sidebar-destination ava-sidebar-new"
            data-active={activeName === "New" || undefined}
            aria-label="New chat"
            onClick={onNewChat}
          >
            <Plus size={18} />
            <span className="ava-sidebar-label">New chat</span>
          </button>

          <button
            type="button"
            className="ava-sidebar-destination"
            data-active={activeName === "Chats" || undefined}
            aria-current={activeName === "Chats" ? "page" : undefined}
            onClick={onOpenCurrentChat}
            aria-label={activeChatSessionId ? "Return to current chat" : "Open chats"}
            title={expanded ? undefined : activeChatSessionId ? "Return to current chat" : "Chats"}
          >
            <MessageSquareText size={18} />
            <span className="ava-sidebar-label">{activeChatSessionId ? "Current chat" : "Chats"}</span>
            {activeChatSessionId && <ChevronRight size={14} className="ava-sidebar-trailing" />}
          </button>

          <div className="ava-sidebar-destinations">
            {grouped.main.map(renderDestination)}
          </div>

          {expanded && (
            <section className="ava-sidebar-recents" aria-labelledby="recent-chats-heading">
              <div className="ava-sidebar-section-title">
                <span id="recent-chats-heading">Recent chats</span>
                <button type="button" onClick={onOpenAllChats} aria-label="View all chats">
                  <History size={14} />
                </button>
              </div>
              {loading && <p className="ava-sidebar-muted">Loading conversations…</p>}
              {!loading && loadError && (
                <button type="button" className="ava-sidebar-muted text-left" onClick={onOpenAllChats}>
                  Chats unavailable · open history
                </button>
              )}
              {!loading && !loadError && recent.length === 0 && (
                <p className="ava-sidebar-muted">Your conversations will appear here.</p>
              )}
              {!loading && !loadError && recent.map((session) => (
                <button
                  type="button"
                  key={session.id}
                  className="ava-sidebar-chat"
                  data-current={session.id === activeChatSessionId || undefined}
                  aria-current={session.id === activeChatSessionId ? "page" : undefined}
                  onClick={() => onOpenChat(session.id)}
                >
                  <span className="ava-sidebar-chat-title">{session.title || "Untitled chat"}</span>
                  <span className="ava-sidebar-chat-time">{formatRecentTime(session.updated_at)}</span>
                </button>
              ))}
              <button type="button" className="ava-sidebar-all" onClick={onOpenAllChats}>
                <span>All conversations</span>
                <ChevronRight size={14} />
              </button>
            </section>
          )}

          <div className="ava-sidebar-workspaces">
            {expanded && <p className="ava-sidebar-eyebrow">Workspaces</p>}
            {grouped.work.map(renderDestination)}
          </div>
          <div className="ava-sidebar-system">
            {grouped.system.map(renderDestination)}
          </div>
        </nav>

        <button
          type="button"
          className="ava-sidebar-collapse"
          onClick={() => onExpandedChange(!expanded)}
          aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
        >
          {expanded ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
          <span className="ava-sidebar-label">Collapse</span>
        </button>
      </aside>
    </>
  );
}
