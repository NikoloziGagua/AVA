import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Plus, Search, Star, Trash2, X } from "lucide-react";
import { api, fetchSessionPage, lastHumanActivity, type SessionRow, type SessionScope } from "../api.js";
import { Button } from "../design/Button.js";
import { TextInput } from "../design/Field.js";
import { Page, PageHeader, Section } from "../design/Page.js";
import { EmptyState, ErrorState, Skeleton } from "../design/States.js";
import { cn } from "../design/cn.js";

const PAGE_SIZE = 30;
const DAY = 86_400_000;

export interface ChatListScreenProps {
  // Kept for API parity with App.tsx; the persistent nav now handles "back",
  // so no in-panel back button is rendered.
  onClose: () => void;
  /** `audit` opens an automated run for reference without making it the current chat. */
  onOpenChat: (sessionId: string | null, options?: { audit?: boolean }) => void;
}

/** Nika's conversations, older unclassified history, and AVA's own automated runs. */
type Section = "human" | "legacy" | "automation";

interface PendingDelete {
  session: SessionRow;
  section: Section;
  timeoutId: ReturnType<typeof setTimeout>;
}

interface Page {
  rows: SessionRow[];
  cursor: string | null;
  loading: boolean;
  error: string | null;
  loaded: boolean;
}

const EMPTY_PAGE: Page = { rows: [], cursor: null, loading: false, error: null, loaded: false };
const UNDO_WINDOW_MS = 5000;

function startOfDay(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "Today", "Yesterday", a weekday this week, else a date. */
export function dayLabel(at: number, now = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  const d = new Date(at);
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString(undefined, { day: "numeric", month: "long", ...(sameYear ? {} : { year: "numeric" }) });
}

function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** "14:32" today, otherwise the day and time. */
function formatWhen(at: number): string {
  const day = dayLabel(at);
  return day === "Today" ? clockTime(at) : `${day} · ${clockTime(at)}`;
}

/** Rows grouped under their day, newest day first, keeping the given order inside a day. */
function groupByDay(rows: SessionRow[], when: (row: SessionRow) => number): Array<{ label: string; rows: SessionRow[] }> {
  const groups: Array<{ label: string; rows: SessionRow[] }> = [];
  for (const row of rows) {
    const label = dayLabel(when(row));
    const group = groups.find((g) => g.label === label);
    if (group) group.rows.push(row);
    else groups.push({ label, rows: [row] });
  }
  return groups;
}

const matches = (row: SessionRow, query: string) => (row.title ?? "Untitled").toLocaleLowerCase().includes(query);

function withoutDuplicates(existing: SessionRow[], incoming: SessionRow[]): SessionRow[] {
  const seen = new Set(existing.map((row) => row.id));
  return [...existing, ...incoming.filter((row) => !seen.has(row.id))];
}

export function ChatListScreen({ onOpenChat }: ChatListScreenProps) {
  const [pages, setPages] = useState<Record<Section, Page>>({
    human: { ...EMPTY_PAGE, loading: true },
    legacy: EMPTY_PAGE,
    automation: EMPTY_PAGE,
  });
  const [openHistory, setOpenHistory] = useState<Record<"legacy" | "automation", boolean>>({
    legacy: false,
    automation: false,
  });
  // A QUEUE of pending deletes, each with its OWN 5s timer — deleting a second
  // chat no longer silently flushes the first's undo window. The toast reflects
  // the latest; undo is LIFO.
  const [pendingDeletes, setPendingDeletes] = useState<PendingDelete[]>([]);
  const [query, setQuery] = useState("");

  // Mirror the queue into a ref so the unmount cleanup can commit any still-open
  // deletes without re-subscribing (deps: []). Leaving the screen mid-undo must
  // honor the delete (the window is gone) AND clear the timer so no setState
  // fires on an unmounted component.
  const pendingRef = useRef<PendingDelete[]>([]);
  useEffect(() => { pendingRef.current = pendingDeletes; }, [pendingDeletes]);
  useEffect(() => () => {
    for (const p of pendingRef.current) {
      clearTimeout(p.timeoutId);
      commitDelete(p);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setPage = useCallback((section: Section, update: (page: Page) => Page) => {
    setPages((prev) => ({ ...prev, [section]: update(prev[section]) }));
  }, []);

  const loadPage = useCallback(async (section: Section, cursor: string | null) => {
    setPage(section, (page) => ({ ...page, loading: true, error: null }));
    try {
      const result = await fetchSessionPage({ scope: section as SessionScope, limit: PAGE_SIZE, cursor });
      setPage(section, (page) => ({
        rows: cursor ? withoutDuplicates(page.rows, result.sessions) : result.sessions,
        cursor: result.nextCursor,
        loading: false,
        error: null,
        loaded: true,
      }));
    } catch (error) {
      setPage(section, (page) => ({ ...page, loading: false, error: String(error), loaded: true }));
    }
  }, [setPage]);

  useEffect(() => { void loadPage("human", null); }, [loadPage]);

  const toggleHistory = (section: "legacy" | "automation") => {
    const next = !openHistory[section];
    setOpenHistory((prev) => ({ ...prev, [section]: next }));
    if (next && !pages[section].loaded && !pages[section].loading) void loadPage(section, null);
  };

  const human = pages.human;
  // A pinned older conversation is listed with Nika's own; don't show it twice.
  const humanIds = new Set(human.rows.map((row) => row.id));
  const legacyRows = pages.legacy.rows.filter((row) => !humanIds.has(row.id));

  // Pinned conversations come first; the rest are grouped by the day Niko last
  // used them. Search narrows what is loaded; "Show more" loads further back.
  const needle = query.trim().toLocaleLowerCase();
  const visible = (rows: SessionRow[]) => (needle ? rows.filter((row) => matches(row, needle)) : rows);
  const pinned = visible(human.rows.filter((s) => s.pinned));
  const unpinned = visible(human.rows.filter((s) => !s.pinned));
  const days = groupByDay(unpinned, lastHumanActivity);

  function commitDelete(p: { session: SessionRow; section: Section }) {
    api.deleteSession(p.session.id).catch(() => {
      setPage(p.section, (page) => (
        page.rows.some((row) => row.id === p.session.id)
          ? page
          : { ...page, rows: [p.session, ...page.rows] }
      ));
    });
  }

  function handleDelete(session: SessionRow, section: Section) {
    setPage(section, (page) => ({ ...page, rows: page.rows.filter((row) => row.id !== session.id) }));
    // Each delete gets its own independent timer; prior pending deletes keep
    // their full undo window (no silent flush).
    const timeoutId = setTimeout(() => {
      commitDelete({ session, section });
      setPendingDeletes((prev) => prev.filter((p) => p.session.id !== session.id));
    }, UNDO_WINDOW_MS);
    setPendingDeletes((prev) => [...prev, { session, section, timeoutId }]);
  }

  // Undo the most recent pending delete (LIFO — matches the toast, which shows the latest).
  function handleUndo() {
    const last = pendingDeletes[pendingDeletes.length - 1];
    if (!last) return;
    clearTimeout(last.timeoutId);
    setPage(last.section, (page) => ({ ...page, rows: [last.session, ...page.rows] }));
    setPendingDeletes((prev) => prev.filter((p) => p !== last));
  }

  // Commit a specific pending delete now (the toast's dismiss/X).
  function commitNow(p: PendingDelete) {
    clearTimeout(p.timeoutId);
    commitDelete(p);
    setPendingDeletes((prev) => prev.filter((x) => x !== p));
  }

  // Optimistic pin/unpin, then persist; revert on rejection. Pinning an older
  // conversation is an explicit choice, so it joins Nika's own list.
  function handleTogglePin(session: SessionRow, section: Section) {
    const next = session.pinned ? 0 : 1;
    const updated = { ...session, pinned: next };
    if (section === "legacy") {
      setPage("legacy", (page) => ({ ...page, rows: page.rows.filter((row) => row.id !== session.id) }));
      setPage("human", (page) => ({ ...page, rows: [updated, ...page.rows] }));
    } else {
      setPage(section, (page) => ({ ...page, rows: page.rows.map((row) => (row.id === session.id ? updated : row)) }));
    }
    api.setSessionPinned(session.id, next === 1).catch(() => {
      if (section === "legacy") {
        setPage("human", (page) => ({ ...page, rows: page.rows.filter((row) => row.id !== session.id) }));
        setPage("legacy", (page) => ({ ...page, rows: [session, ...page.rows] }));
      } else {
        setPage(section, (page) => ({ ...page, rows: page.rows.map((row) => (row.id === session.id ? session : row)) }));
      }
    });
  }

  const renderRows = (rows: SessionRow[], section: Section) => (
    <ul className="grid gap-2">
      {rows.map((s) => {
        const title = s.title ?? "Untitled";
        const open = () => onOpenChat(s.id, section === "automation" ? { audit: true } : undefined);
        return (
          <li key={s.id} className="flex min-h-14 items-center gap-1 rounded-card bg-surface py-1.5 pl-4 pr-1.5 shadow-e1 transition-colors hover:bg-surface-strong">
            <button
              type="button"
              onClick={open}
              aria-labelledby={`${section}-${s.id}-title`}
              aria-describedby={`${section}-${s.id}-when`}
              className="ds-focus grid min-w-0 flex-1 gap-0.5 rounded-control py-1 text-left"
            >
              <span id={`${section}-${s.id}-title`} className="truncate text-body text-ink">{title}</span>
              <span id={`${section}-${s.id}-when`} className="text-meta text-ink-3">
                {formatWhen(section === "human" ? lastHumanActivity(s) : s.updated_at)}
              </span>
            </button>
            {section !== "automation" && (
              <IconButton
                label={`${s.pinned ? "Unpin" : "Pin"} ${title}`}
                pressed={Boolean(s.pinned)}
                onClick={() => handleTogglePin(s, section)}
              >
                <Star size={16} fill={s.pinned ? "currentColor" : "none"} aria-hidden="true" />
              </IconButton>
            )}
            <IconButton label={`Delete ${title}`} onClick={() => handleDelete(s, section)} danger>
              <Trash2 size={16} aria-hidden="true" />
            </IconButton>
          </li>
        );
      })}
    </ul>
  );

  const renderMore = (section: Section) => {
    const page = pages[section];
    if (!page.cursor) return null;
    return (
      <div className="flex justify-center">
        <Button variant="glass" size="sm" loading={page.loading} disabled={page.loading} onClick={() => void loadPage(section, page.cursor)}>
          {page.loading ? "Loading…" : "Show more"}
        </Button>
      </div>
    );
  };

  const renderHistory = (section: "legacy" | "automation", title: string, description: string) => {
    const page = pages[section];
    const rows = visible(section === "legacy" ? legacyRows : page.rows);
    const open = openHistory[section];
    const regionId = `chat-history-${section}`;
    return (
      <section className="grid gap-3">
        <button
          type="button"
          aria-label={`${open ? "Hide" : "Show"} ${title.toLowerCase()}`}
          aria-expanded={open}
          aria-controls={regionId}
          onClick={() => toggleHistory(section)}
          className="ds-focus flex items-center justify-between gap-3 rounded-card bg-glass px-4 py-3 text-left transition-colors hover:bg-glass-strong"
        >
          <span className="grid gap-0.5">
            <span className="text-body font-medium text-ink">{title}</span>
            <span className="text-meta text-ink-2">{description}</span>
          </span>
          <ChevronDown size={18} aria-hidden="true" className={cn("shrink-0 text-ink-3 transition-transform", open && "rotate-180")} />
        </button>
        {open && (
          <div id={regionId} className="grid gap-3">
            {page.loading && !page.loaded && <Skeleton lines={3} />}
            {page.error && <ErrorState title="Couldn't load these conversations." body={page.error} onRetry={() => void loadPage(section, null)} />}
            {page.loaded && !page.error && rows.length === 0 && <p className="px-1 text-meta text-ink-2">Nothing here.</p>}
            {rows.length > 0 && renderRows(rows, section)}
            {renderMore(section)}
          </div>
        )}
      </section>
    );
  };

  const latest = pendingDeletes[pendingDeletes.length - 1];

  return (
    <div className="ds-root absolute inset-0 overflow-y-auto bg-canvas font-ui text-ink">
      <Page width="narrow">
        <PageHeader
          title="Conversations"
          actions={(
            <Button variant="solid" size="sm" leading={<Plus size={16} aria-hidden="true" />} onClick={() => onOpenChat(null)}>
              New conversation
            </Button>
          )}
        />

        <label className="relative block">
          <span className="sr-only">Search conversations</span>
          <Search size={17} aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-3" />
          <TextInput
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by title"
            className="pl-11"
          />
        </label>
        {needle && human.cursor && (
          <p className="-mt-4 px-1 text-meta text-ink-3">Searching the conversations loaded so far. Show more to look further back.</p>
        )}

        {pinned.length > 0 && (
          <Section label="Pinned">{renderRows(pinned, "human")}</Section>
        )}

        {human.loading && !human.loaded && <Skeleton lines={4} />}

        {human.loaded && human.error && (
          <ErrorState title="Couldn't load your conversations." body={human.error} onRetry={() => void loadPage("human", null)} />
        )}

        {human.loaded && !human.error && human.rows.length === 0 && (
          <EmptyState
            title="No conversations yet"
            body="Start one from the bar below, or here."
            action={<Button variant="solid" onClick={() => onOpenChat(null)}>Start a conversation</Button>}
          />
        )}

        {human.loaded && !human.error && human.rows.length > 0 && needle && pinned.length === 0 && unpinned.length === 0 && (
          <p className="px-1 text-body text-ink-2">No loaded conversation matches “{query.trim()}”.</p>
        )}

        {human.loaded && !needle && unpinned.length === 0 && pinned.length > 0 && (
          <p className="px-1 text-meta text-ink-2">All your conversations are pinned.</p>
        )}

        {days.map((day) => (
          <Section key={day.label} label={day.label}>{renderRows(day.rows, "human")}</Section>
        ))}
        {renderMore("human")}

        {renderHistory(
          "legacy",
          "Older history",
          "Conversations from before AVA separated your chats from automated runs. Open one to continue it.",
        )}
        {renderHistory(
          "automation",
          "Automated runs",
          "Watches and other work AVA did on its own. Shown for reference; they never become your current chat.",
        )}
      </Page>

      {latest && (
        <div
          role="status"
          className="ds-root ds-rise fixed inset-x-0 z-30 mx-auto flex w-[calc(100%-2rem)] max-w-md items-center gap-2 rounded-full bg-solid py-1.5 pl-5 pr-1.5 text-meta text-on-solid shadow-e3"
          style={{ bottom: "calc(var(--ds-bar-space, 72px) + env(safe-area-inset-bottom, 0px) + 0.75rem)" }}
        >
          <span className="min-w-0 flex-1 truncate">
            Deleted “{latest.session.title ?? "Untitled"}”{pendingDeletes.length > 1 ? ` (+${pendingDeletes.length - 1} more)` : ""}.
          </span>
          <button type="button" onClick={handleUndo} className="ds-focus rounded-full px-3 py-2 font-medium underline underline-offset-2">
            Undo
          </button>
          <button type="button" aria-label="Delete now" onClick={() => commitNow(latest)} className="ds-focus grid h-9 w-9 place-items-center rounded-full">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}

function IconButton({ label, onClick, pressed, danger, children }: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "ds-focus grid h-11 w-11 shrink-0 place-items-center rounded-full transition-colors",
        pressed ? "text-ink" : "text-ink-3",
        danger ? "hover:bg-danger-soft hover:text-danger" : "hover:bg-glass hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
