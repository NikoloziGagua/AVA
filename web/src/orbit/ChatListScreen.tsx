import { useEffect, useRef, useState } from "react";
import { Trash2, Plus, Star } from "lucide-react";
import { api, fetchSessions, type SessionRow } from "../api.js";
import { Alert, AlertDescription } from "../components/ui/alert.js";
import { PanelShell, PanelSection } from "../components/ava/PanelShell.js";
import { DisplayCards, MAX_FANNED, type DisplayCard } from "../components/ava/DisplayCards.js";
import { ContainerScroll } from "../components/ava/ContainerScroll.js";
import { Flip, gsap, useGSAP } from "../lib/gsap.js";
import { useReducedMotion } from "../lib/useReducedMotion.js";
import { press } from "../lib/deckMotion.js";

export interface ChatListScreenProps {
  // Kept for API parity with App.tsx; the persistent nav now handles "back",
  // so no in-panel back button is rendered.
  onClose: () => void;
  onOpenChat: (sessionId: string | null) => void;
}

interface PendingDelete {
  session: SessionRow;
  timeoutId: ReturnType<typeof setTimeout>;
}

const UNDO_WINDOW_MS = 5000;

/** "Mon · 14:32" style last-active label used by both the strip and the table. */
function lastActive(s: SessionRow): string {
  const d = new Date(s.updated_at);
  return `${d.toLocaleDateString()} · ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

export function ChatListScreen({ onOpenChat }: ChatListScreenProps) {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const reduced = useReducedMotion();

  // Flip snapshot taken in a list-mutating handler; consumed by the layout-effect
  // below after React commits the new DOM (per deckMotion §3a pattern). Covers BOTH
  // the delete/undo reorder AND a pin/unpin move between the strip and the table.
  const flipState = useRef<Flip.FlipState | null>(null);
  const listScope = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchSessions()
      .then((s) => setSessions(s))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // The "Important chats" strip shows at most MAX_FANNED pinned chats; any pinned
  // beyond that OVERFLOW into the table (with a lit star) so a 5th+ pin is never
  // invisible. The table therefore lists overflow-pinned first, then the unpinned.
  const pinned = sessions.filter((s) => s.pinned);
  const unpinned = sessions.filter((s) => !s.pinned);
  const stripPinned = pinned.slice(0, MAX_FANNED);
  const tableRows = [...pinned.slice(MAX_FANNED), ...unpinned];

  // Stagger the rows in on first paint, Flip them when the list reorders (delete /
  // undo / pin / unpin), and pulse the loading skeletons. All reduced-motion gated.
  useGSAP(
    () => {
      // List reorder/delete/pin: replay the captured layout via Flip. We snapshot
      // BOTH the table rows and the strip cards so a row can fly from one to the other.
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
      // Loading: gentle opacity yoyo on the skeleton slabs.
      if (loading) {
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
      // Initial reveal — cascade the individual rows in beneath the section.
      gsap.from(".chat-row", {
        y: 12,
        opacity: 0,
        duration: 0.45,
        ease: "power2.out",
        stagger: 0.04,
        clearProps: "transform,opacity",
      });
    },
    { dependencies: [sessions, loading, reduced], scope: listScope },
  );

  // Snapshot every element that can move in a reorder: the table rows AND the pinned
  // strip cards (so a row Flips smoothly into/out of the "Important chats" cluster).
  function snapshotForFlip() {
    flipState.current = reduced ? null : Flip.getState(".chat-row, .dc-card");
  }

  function commitDelete(s: SessionRow) {
    api.deleteSession(s.id).catch(() => {
      setSessions((prev) => (prev.some((x) => x.id === s.id) ? prev : [s, ...prev]));
    });
  }

  function handleDelete(s: SessionRow) {
    snapshotForFlip();
    if (pendingDelete) {
      clearTimeout(pendingDelete.timeoutId);
      commitDelete(pendingDelete.session);
    }
    setSessions((prev) => prev.filter((x) => x.id !== s.id));
    const timeoutId = setTimeout(() => {
      commitDelete(s);
      setPendingDelete(null);
    }, UNDO_WINDOW_MS);
    setPendingDelete({ session: s, timeoutId });
  }

  function handleUndo() {
    if (!pendingDelete) return;
    snapshotForFlip();
    clearTimeout(pendingDelete.timeoutId);
    setSessions((prev) => [pendingDelete.session, ...prev]);
    setPendingDelete(null);
  }

  // Optimistic pin/unpin: flip s.pinned locally (which moves the row between the table
  // and the strip), wrap the move in a Flip reorder, then persist. On rejection, revert.
  function handleTogglePin(s: SessionRow) {
    const next = s.pinned ? 0 : 1;
    snapshotForFlip();
    setSessions((prev) => prev.map((x) => (x.id === s.id ? { ...x, pinned: next } : x)));
    api.setSessionPinned(s.id, next === 1).catch(() => {
      setSessions((prev) => prev.map((x) => (x.id === s.id ? { ...x, pinned: s.pinned } : x)));
    });
  }

  const displayCards: DisplayCard[] = stripPinned.map((s) => ({
    id: s.id,
    title: s.title ?? "Untitled",
    subtitle: lastActive(s),
    onOpen: () => onOpenChat(s.id),
    onUnpin: () => handleTogglePin(s),
  }));

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

  return (
    <PanelShell title="Chats">
      <div ref={listScope}>
        {/* IMPORTANT CHATS — only when something is pinned. */}
        {pinned.length > 0 && (
          <PanelSection title="Important chats">
            <ContainerScroll>
              <DisplayCards cards={displayCards} />
            </ContainerScroll>
          </PanelSection>
        )}

        {/* ALL CHATS — the deck table. */}
        <PanelSection title="All chats" right={newChatBtn}>
          {loading && (
            <div className="grid grid-cols-1 gap-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="chat-skel lg-slab h-[52px] rounded-xl opacity-70" />
              ))}
            </div>
          )}

          {!loading && sessions.length === 0 && (
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

          {!loading && tableRows.length === 0 && pinned.length > 0 && (
            <div className="hud py-8 text-center text-[11px] tracking-[0.2em] text-white/35">
              ALL CHATS ARE PINNED
            </div>
          )}

          {!loading && tableRows.length > 0 && (
            <table className="chat-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Last active</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((s) => (
                  <tr
                    key={s.id}
                    className="chat-row"
                    onClick={() => onOpenChat(s.id)}
                  >
                    <td>
                      <div className="truncate text-sm text-white/90">{s.title ?? "Untitled"}</div>
                    </td>
                    <td>
                      <div className="hud text-[10px] tracking-[0.16em] text-white/40">
                        {lastActive(s)}
                      </div>
                    </td>
                    <td>
                      <div className="chat-actions">
                        <button
                          aria-label={s.pinned ? "unpin" : "pin"}
                          data-on={s.pinned ? "true" : "false"}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTogglePin(s);
                          }}
                          className="chat-act chat-act-star"
                        >
                          <Star size={14} fill={s.pinned ? "currentColor" : "none"} strokeWidth={1.5} />
                        </button>
                        <button
                          aria-label="delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(s);
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
          )}
        </PanelSection>
      </div>

      {pendingDelete && (
        <div className="sticky bottom-6 z-20 mx-auto max-w-md">
          <Alert
            variant="info"
            close
            className="lg-slab border-0"
            onClose={() => {
              if (pendingDelete) {
                clearTimeout(pendingDelete.timeoutId);
                commitDelete(pendingDelete.session);
              }
              setPendingDelete(null);
            }}
          >
            <AlertDescription>
              Deleted "{pendingDelete.session.title ?? "Untitled"}".
              <button className="ml-2 underline decoration-[var(--ac)] underline-offset-2 hover:text-[var(--ac)]" onClick={handleUndo}>
                undo
              </button>
            </AlertDescription>
          </Alert>
        </div>
      )}
    </PanelShell>
  );
}
