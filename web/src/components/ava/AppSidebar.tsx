import { useEffect, useMemo, useState, type ComponentType } from "react";
import {
  ChevronDown,
  ChevronRight,
  History,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
} from "lucide-react";
import { fetchSessionPage, lastHumanActivity, type SessionRow } from "../../api.js";

export interface AppSidebarItem {
  name: string;
  label: string;
  icon: ComponentType<{ size?: number | string; className?: string }>;
  onSelect: () => void;
  /** Everyday destinations are always visible; AVA's own tools live under System. */
  group: "primary" | "system";
}

export interface AppSidebarProps {
  items: AppSidebarItem[];
  activeName?: string;
  visible: boolean;
  expanded: boolean;
  activeChatSessionId: string | null;
  onExpandedChange: (expanded: boolean) => void;
  onNewChat: () => void;
  onOpenChat: (sessionId: string) => void;
  onOpenAllChats: () => void;
}

const RECENT_LIMIT = 8;
/**
 * Below 1024px the expanded drawer overlays the page behind a scrim (see
 * `.ava-sidebar-scrim` in theme.css), so choosing a destination closes it.
 */
const OVERLAY_QUERY = "(max-width: 1023px)";

function formatRecentTime(value: number): string {
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** The server already orders human conversations; only lift the current one to the top. */
function orderedRecent(sessions: SessionRow[], current: string | null): SessionRow[] {
  const index = current ? sessions.findIndex((session) => session.id === current) : -1;
  if (index <= 0) return sessions;
  return [sessions[index]!, ...sessions.slice(0, index), ...sessions.slice(index + 1)];
}

function drawerOverlays(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    && window.matchMedia(OVERLAY_QUERY).matches;
}

export function AppSidebar({
  items,
  activeName,
  visible,
  expanded,
  activeChatSessionId,
  onExpandedChange,
  onNewChat,
  onOpenChat,
  onOpenAllChats,
}: AppSidebarProps) {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const primary = items.filter((item) => item.group === "primary");
  const system = items.filter((item) => item.group === "system");
  const systemActive = system.some((item) => item.name === activeName);
  const [systemOpen, setSystemOpen] = useState(systemActive);
  useEffect(() => { if (systemActive) setSystemOpen(true); }, [systemActive]);

  // Only Nika's own conversations, bounded. The remembered chat is never cleared
  // because it is missing from this page: an exact lookup decides availability
  // when it is actually opened.
  useEffect(() => {
    if (!expanded || !visible) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    void (async () => {
      try {
        const page = await fetchSessionPage({ scope: "human", limit: RECENT_LIMIT });
        if (!cancelled) setSessions(page.sessions);
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeChatSessionId, expanded, visible]);

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

  /** Every choice made from a drawer that overlays the page closes it. */
  const choose = (action: () => void) => () => {
    action();
    if (expanded && drawerOverlays()) onExpandedChange(false);
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
        onClick={choose(item.onSelect)}
        className="ava-sidebar-destination"
        data-active={selected || undefined}
      >
        <Icon size={18} className="shrink-0" />
        <span className="ava-sidebar-label">{item.label}</span>
      </button>
    );
  };

  const toggleSystem = () => {
    if (!expanded) {
      // The compact rail has no room for the list: open the drawer onto it.
      setSystemOpen(true);
      onExpandedChange(true);
      return;
    }
    setSystemOpen((open) => !open);
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
        inert={!visible}
      >
        <div className="ava-sidebar-head">
          <button
            type="button"
            className="ava-sidebar-brand"
            aria-label={expanded ? "Collapse navigation" : "Expand navigation"}
            aria-expanded={expanded}
            onClick={() => onExpandedChange(!expanded)}
          >
            <span className="ava-sidebar-toggle" aria-hidden>
              {expanded ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
            </span>
            <span className="ava-sidebar-brand-copy">
              <strong>Navigation</strong>
              <small>Move without losing your place</small>
            </span>
          </button>
        </div>

        <nav className="ava-sidebar-nav" aria-label="Primary">
          <button
            type="button"
            className="ava-sidebar-destination ava-sidebar-new"
            data-active={activeName === "New" || undefined}
            aria-label="New chat"
            title={expanded ? undefined : "New chat"}
            onClick={choose(onNewChat)}
          >
            <Plus size={18} className="shrink-0" />
            <span className="ava-sidebar-label">New chat</span>
          </button>

          <div className="ava-sidebar-destinations">
            {primary.map(renderDestination)}
          </div>

          {expanded && visible && (
            <section className="ava-sidebar-recents" aria-labelledby="recent-chats-heading">
              <div className="ava-sidebar-section-title">
                <span id="recent-chats-heading">Conversations</span>
                <button type="button" onClick={choose(onOpenAllChats)} aria-label="View all chats">
                  <History size={14} />
                </button>
              </div>
              {loading && <p className="ava-sidebar-muted">Loading conversations…</p>}
              {!loading && loadError && (
                <button type="button" className="ava-sidebar-muted text-left" onClick={choose(onOpenAllChats)}>
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
                  onClick={choose(() => onOpenChat(session.id))}
                >
                  <span className="ava-sidebar-chat-title">{session.title || "Untitled chat"}</span>
                  <span className="ava-sidebar-chat-time">{formatRecentTime(lastHumanActivity(session))}</span>
                </button>
              ))}
              <button type="button" className="ava-sidebar-all" onClick={choose(onOpenAllChats)}>
                <span>All conversations</span>
                <ChevronRight size={14} />
              </button>
            </section>
          )}

          <div className="ava-sidebar-system">
            <button
              type="button"
              className="ava-sidebar-destination"
              aria-expanded={expanded ? systemOpen : false}
              aria-controls="ava-sidebar-system-list"
              aria-label="System"
              title={expanded ? undefined : "System"}
              data-active={(systemActive && !(expanded && systemOpen)) || undefined}
              onClick={toggleSystem}
            >
              <Layers size={18} className="shrink-0" />
              <span className="ava-sidebar-label">System</span>
              <ChevronDown
                size={14}
                className="ava-sidebar-trailing"
                style={{ transform: systemOpen ? "rotate(180deg)" : undefined }}
                aria-hidden
              />
            </button>
            {expanded && systemOpen && (
              <div id="ava-sidebar-system-list" className="ava-sidebar-destinations" role="group" aria-label="System tools">
                {system.map(renderDestination)}
              </div>
            )}
          </div>
        </nav>
      </aside>
    </>
  );
}
