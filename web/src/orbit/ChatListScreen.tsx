import { useCallback, useEffect, useRef, useState } from "react";
import { Trash2, Plus, Star, ArrowUpRight, ChevronDown } from "lucide-react";
import { api, fetchSessionPage, lastHumanActivity, type SessionRow, type SessionScope } from "../api.js";
import { Alert, AlertDescription } from "../components/ui/alert.js";
import { PanelShell, PanelSection } from "../components/ava/PanelShell.js";
import { igniteBorder, douseBorder } from "../components/ava/BorderGlow.js";
import { ContainerScroll } from "../components/ava/ContainerScroll.js";
import { Flip, gsap, useGSAP } from "../lib/gsap.js";
import { useReducedMotion } from "../lib/useReducedMotion.js";
import { press } from "../lib/deckMotion.js";

/**
 * How many pinned chats get a starred card in the "Important chats" rail; any
 * further pins overflow into the table (with a lit star) so a 4th+ pin is never
 * invisible. Three wide cards fill the deck row exactly.
 */
const MAX_PINNED_CARDS = 3;
const PAGE_SIZE = 30;

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

/** "Mon · 14:32" style label. */
function formatWhen(value: number): string {
  const d = new Date(value);
  return `${d.toLocaleDateString()} · ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

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
  const reduced = useReducedMotion();

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

  // Flip snapshot taken in a list-mutating handler; consumed by the layout-effect
  // below after React commits the new DOM (per deckMotion §3a pattern).
  const flipState = useRef<Flip.FlipState | null>(null);
  const listScope = useRef<HTMLDivElement>(null);

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

  // The "Important chats" rail shows at most MAX_PINNED_CARDS pinned chats; any
  // pinned beyond that OVERFLOW into the table (with a lit star).
  const pinned = human.rows.filter((s) => s.pinned);
  const unpinned = human.rows.filter((s) => !s.pinned);
  const stripPinned = pinned.slice(0, MAX_PINNED_CARDS);
  const tableRows = [...pinned.slice(MAX_PINNED_CARDS), ...unpinned];

  // Stagger the rows in on first paint, Flip them when the list reorders (delete /
  // undo / pin / unpin), and pulse the loading skeletons. All reduced-motion gated.
  useGSAP(
    () => {
      if (flipState.current) {
        if (!reduced) {
          Flip.from(flipState.current, {
            duration: 0.5,
            ease: "power2.inOut",
            absolute: true,
            stagger: 0.04,
          });
        }
        flipState.current = null;
        return;
      }
      if (reduced) return;
      if (human.loading && !human.loaded) {
        gsap.to(".chat-skel", {
          opacity: 0.35,
          duration: 0.7,
          ease: "sine.inOut",
          repeat: -1,
          yoyo: true,
          stagger: 0.12,
        });
        return;
      }
      gsap.from(".chat-row", {
        y: 12,
        opacity: 0,
        duration: 0.45,
        ease: "power2.out",
        stagger: 0.04,
        clearProps: "transform,opacity",
      });
    },
    { dependencies: [human.rows, human.loading, reduced], scope: listScope },
  );

  // Snapshot every element that can move in a reorder: the table rows AND the pinned
  // rail cards (so a row Flips smoothly into/out of the "Important chats" rail).
  function snapshotForFlip() {
    flipState.current = reduced ? null : Flip.getState(".chat-row, .pin-card");
  }

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
    snapshotForFlip();
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
    snapshotForFlip();
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
    snapshotForFlip();
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

  const newChatBtn = (
    <button
      onClick={() => onOpenChat(null)}
      onPointerDown={(e) => press(e.currentTarget, true, reduced)}
      onPointerUp={(e) => press(e.currentTarget, false, reduced)}
      onPointerLeave={(e) => press(e.currentTarget, false, reduced)}
      aria-label="new chat"
      className="btn-deck btn-ghost"
    >
      <Plus size={14} />
      <span>New</span>
    </button>
  );

  const renderTable = (rows: SessionRow[], section: Section) => (
    <table className="chat-table">
      <thead>
        <tr>
          <th>Title</th>
          <th>{section === "human" ? "Last used" : "Last changed"}</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => (
          <tr
            key={s.id}
            className="chat-row"
            onClick={() => onOpenChat(s.id, section === "automation" ? { audit: true } : undefined)}
          >
            <td>
              <div className="truncate text-sm text-white/90">{s.title ?? "Untitled"}</div>
            </td>
            <td>
              <div className="hud text-[10px] tracking-[0.16em] text-white/40">
                {formatWhen(section === "human" ? lastHumanActivity(s) : s.updated_at)}
              </div>
            </td>
            <td>
              <div className="chat-actions">
                {section !== "automation" && (
                  <button
                    aria-label={s.pinned ? "unpin" : "pin"}
                    data-on={s.pinned ? "true" : "false"}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleTogglePin(s, section);
                    }}
                    className="chat-act chat-act-star"
                  >
                    <Star size={14} fill={s.pinned ? "currentColor" : "none"} strokeWidth={1.5} />
                  </button>
                )}
                <button
                  aria-label="delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(s, section);
                  }}
                  className="chat-act chat-act-del"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const renderMore = (section: Section) => {
    const page = pages[section];
    if (!page.cursor) return null;
    return (
      <div className="mt-3 flex justify-center">
        <button
          type="button"
          className="btn-deck btn-ghost"
          disabled={page.loading}
          onClick={() => void loadPage(section, page.cursor)}
        >
          {page.loading ? "Loading…" : "Show more"}
        </button>
      </div>
    );
  };

  const renderHistory = (section: "legacy" | "automation", title: string, description: string) => {
    const page = pages[section];
    const rows = section === "legacy" ? legacyRows : page.rows;
    const open = openHistory[section];
    const regionId = `chat-history-${section}`;
    return (
      <PanelSection
        title={title}
        right={(
          <button
            type="button"
            className="btn-deck btn-ghost"
            aria-label={`${open ? "Hide" : "Show"} ${title.toLowerCase()}`}
            aria-expanded={open}
            aria-controls={regionId}
            onClick={() => toggleHistory(section)}
          >
            <span>{open ? "Hide" : "Show"}</span>
            <ChevronDown size={14} style={{ transform: open ? "rotate(180deg)" : undefined }} />
          </button>
        )}
      >
        <p className="text-xs leading-5 text-white/55">{description}</p>
        {open && (
          <div id={regionId} className="mt-3">
            {page.loading && !page.loaded && <p className="text-xs text-white/55">Loading…</p>}
            {page.error && <div className="py-4 text-center text-sm text-red-400">error: {page.error}</div>}
            {page.loaded && !page.error && rows.length === 0 && (
              <p className="text-xs text-white/55">Nothing here.</p>
            )}
            {rows.length > 0 && renderTable(rows, section)}
            {renderMore(section)}
          </div>
        )}
      </PanelSection>
    );
  };

  return (
    <PanelShell title="Chats">
      <div ref={listScope}>
        {/* IMPORTANT CHATS — only when something is pinned. */}
        {pinned.length > 0 && (
          <PanelSection title="Important chats" right={<span className="chip chip-ac">{pinned.length}</span>}>
            <ContainerScroll>
              <div className="pin-grid">
                {stripPinned.map((s) => (
                  <div
                    key={s.id}
                    role="button"
                    tabIndex={0}
                    className="pin-card bg-card cursor-pointer px-5 py-4"
                    onClick={() => onOpenChat(s.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onOpenChat(s.id);
                      }
                    }}
                    onPointerMove={reduced ? undefined : igniteBorder}
                    onPointerLeave={reduced ? undefined : douseBorder}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="hud text-[9px] tracking-[0.22em] text-[var(--ac)]/75">
                        ★ PINNED
                      </span>
                      <button
                        aria-label="unpin"
                        title="Unpin"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTogglePin(s, "human");
                        }}
                        className="pin-star -mr-1 -mt-1 rounded-md p-1 text-[var(--ac)] transition-colors hover:text-white"
                      >
                        <Star size={14} fill="currentColor" strokeWidth={1.5} />
                      </button>
                    </div>
                    <div className="pin-title mt-2 text-[15px] font-medium leading-snug text-white/92">
                      {s.title ?? "Untitled"}
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="hud text-[10px] tracking-[0.16em] text-white/40">{formatWhen(lastHumanActivity(s))}</span>
                      <span className="pin-open flex items-center gap-1 hud text-[9px] tracking-[0.2em] text-white/35">
                        OPEN <ArrowUpRight size={11} />
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </ContainerScroll>
          </PanelSection>
        )}

        {/* YOUR CONVERSATIONS — only chats Nika actually took part in. */}
        <PanelSection title="Your conversations" right={newChatBtn}>
          {human.loading && !human.loaded && (
            <div className="grid grid-cols-1 gap-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="chat-skel lg-slab h-[52px] rounded-xl opacity-70" />
              ))}
            </div>
          )}

          {human.loaded && human.error && (
            <div className="py-10 text-center text-sm text-red-400">error: {human.error}</div>
          )}

          {human.loaded && !human.error && human.rows.length === 0 && (
            <div className="flex flex-col items-center gap-5 py-14 text-center">
              <div className="hud text-[12px] tracking-[0.22em] text-white/45">NO CHATS YET</div>
              <button
                onClick={() => onOpenChat(null)}
                onPointerDown={(e) => press(e.currentTarget, true, reduced)}
                onPointerUp={(e) => press(e.currentTarget, false, reduced)}
                onPointerLeave={(e) => press(e.currentTarget, false, reduced)}
                aria-label="new chat"
                className="btn-deck btn-primary"
              >
                <Plus size={14} />
                <span>New chat</span>
              </button>
            </div>
          )}

          {human.loaded && tableRows.length === 0 && pinned.length > 0 && (
            <div className="hud py-8 text-center text-[11px] tracking-[0.2em] text-white/35">
              ALL CHATS ARE PINNED
            </div>
          )}

          {tableRows.length > 0 && renderTable(tableRows, "human")}
          {renderMore("human")}
        </PanelSection>

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
      </div>

      {pendingDeletes.length > 0 && (() => {
        const latest = pendingDeletes[pendingDeletes.length - 1]!;
        const extra = pendingDeletes.length - 1;
        return (
          <div className="sticky bottom-6 z-20 mx-auto max-w-md">
            <Alert
              variant="info"
              close
              className="lg-slab border-0"
              onClose={() => commitNow(latest)}
            >
              <AlertDescription>
                Deleted "{latest.session.title ?? "Untitled"}"
                {extra > 0 ? ` (+${extra} more)` : ""}.
                <button className="ml-2 underline decoration-[var(--ac)] underline-offset-2 hover:text-[var(--ac)]" onClick={handleUndo}>
                  undo
                </button>
              </AlertDescription>
            </Alert>
          </div>
        );
      })()}
    </PanelShell>
  );
}
