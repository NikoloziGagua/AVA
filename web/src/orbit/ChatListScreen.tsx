import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Trash2, Plus } from "lucide-react";
import { api, fetchSessions, type SessionRow } from "../api.js";
import { Alert, AlertDescription } from "../components/ui/alert.js";
import { PanelShell, PanelSection } from "../components/ava/PanelShell.js";
import { Flip, gsap, useGSAP } from "../lib/gsap.js";
import { useReducedMotion } from "../lib/useReducedMotion.js";
import { EASE, hoverLift, press } from "../lib/deckMotion.js";

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

export function ChatListScreen({ onOpenChat }: ChatListScreenProps) {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const reduced = useReducedMotion();

  // Flip snapshot taken in a list-mutating handler; consumed by the layout-effect
  // below after React commits the new DOM (per deckMotion §3a pattern).
  const flipState = useRef<Flip.FlipState | null>(null);
  const listScope = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchSessions()
      .then((s) => setSessions(s))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Stagger the cards in on first paint, Flip them when the list reorders
  // (delete / undo), and pulse the loading skeletons. All reduced-motion gated.
  useGSAP(
    () => {
      // List reorder/delete: replay the captured layout via Flip.
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
      // Initial reveal — cascade the individual cards in beneath the section.
      gsap.from(".chat-card", {
        y: 16,
        opacity: 0,
        duration: 0.5,
        ease: EASE,
        stagger: 0.05,
        clearProps: "transform,opacity",
      });
    },
    { dependencies: [sessions, loading, reduced], scope: listScope },
  );

  function snapshotForFlip() {
    flipState.current = reduced ? null : Flip.getState(".chat-card");
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
      <PanelSection title="All chats" right={newChatBtn}>
        <div ref={listScope}>
          {loading && (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="chat-skel lg-slab h-[60px] rounded-xl opacity-70" />
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

          {!loading && sessions.length > 0 && (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {sessions.map((s) => (
                <div
                  key={s.id}
                  className="chat-card lg-slab lg-sweep group relative flex cursor-pointer items-center gap-3 rounded-xl px-4 py-3"
                  style={{ "--sweep-x": "-130%" } as CSSProperties}
                  onClick={() => onOpenChat(s.id)}
                  onMouseEnter={(e) => hoverLift(e.currentTarget, true, reduced)}
                  onMouseLeave={(e) => hoverLift(e.currentTarget, false, reduced)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-white/90">{s.title ?? "Untitled"}</div>
                    <div className="hud mt-1 text-[10px] tracking-[0.16em] text-white/40">
                      {new Date(s.updated_at).toLocaleDateString()} ·{" "}
                      {new Date(s.updated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                  <button
                    aria-label="delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(s);
                    }}
                    className="relative z-10 rounded-md p-1.5 text-white/45 opacity-40 transition-opacity hover:text-[#ff8c8c] group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </PanelSection>

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
