import { useEffect, useState } from "react";
import { ChevronLeft, Trash2, Plus } from "lucide-react";
import { api, fetchSessions, type SessionRow } from "../api.js";
import { Alert, AlertDescription } from "../components/ui/alert.js";
import { useGsapReveal } from "../lib/useGsapReveal.js";

export interface ChatListScreenProps {
  onClose: () => void;
  onOpenChat: (sessionId: string | null) => void;
}

interface PendingDelete {
  session: SessionRow;
  timeoutId: ReturnType<typeof setTimeout>;
}

const UNDO_WINDOW_MS = 5000;

export function ChatListScreen({ onClose, onOpenChat }: ChatListScreenProps) {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const shellRef = useGsapReveal([loading, sessions.length]);

  useEffect(() => {
    fetchSessions()
      .then((s) => setSessions(s))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function commitDelete(s: SessionRow) {
    api.deleteSession(s.id).catch(() => {
      setSessions((prev) => prev.some((x) => x.id === s.id) ? prev : [s, ...prev]);
    });
  }

  function handleDelete(s: SessionRow) {
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
    clearTimeout(pendingDelete.timeoutId);
    setSessions((prev) => [pendingDelete.session, ...prev]);
    setPendingDelete(null);
  }

  return (
    <div ref={shellRef} className="ava-luxe-screen ava-luxe-scroll text-white">
      <header data-gsap-reveal className="ava-luxe-header">
        <button onClick={onClose} aria-label="back" className="ava-icon-button shrink-0">
          <ChevronLeft size={20} />
        </button>
        <div className="min-w-0">
          <div className="ava-kicker mb-1">archive</div>
          <div className="ava-luxe-title text-sm">All chats</div>
        </div>
        <button
          onClick={() => onOpenChat(null)}
          aria-label="new chat"
          className="ava-icon-button ml-auto"
        >
          <Plus size={14} />
        </button>
      </header>

      <div className="relative z-10 space-y-2 px-4 py-4">
        {loading && <div data-gsap-reveal className="text-xs text-[var(--ava-fg-faint)]">Loading...</div>}
        {!loading && sessions.length === 0 && (
          <div data-gsap-reveal className="ava-glass-panel py-8 text-center text-xs text-[var(--ava-fg-muted)]">
            No chats yet.
          </div>
        )}
        {sessions.map((s) => (
          <div
            key={s.id}
            data-gsap-reveal
            className="ava-luxe-row group flex cursor-pointer items-center gap-3 px-3 py-3 text-xs"
            onClick={() => onOpenChat(s.id)}
          >
            <div className="flex-1 min-w-0">
              <div className="truncate text-[var(--ava-ink)]">{s.title ?? "Untitled"}</div>
              <div className="mt-1 text-[10px] text-[var(--ava-fg-faint)]">
                {new Date(s.updated_at).toLocaleDateString()} / {new Date(s.updated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
            <button
              aria-label="delete"
              onClick={(e) => { e.stopPropagation(); handleDelete(s); }}
              className="p-1.5 text-[var(--ava-fg-faint)] opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      {pendingDelete && (
        <div className="sticky bottom-4 z-20 mx-4">
          <Alert variant="info" close onClose={() => {
            if (pendingDelete) {
              clearTimeout(pendingDelete.timeoutId);
              commitDelete(pendingDelete.session);
            }
            setPendingDelete(null);
          }}>
            <AlertDescription>
              Deleted "{pendingDelete.session.title ?? "Untitled"}".
              <button className="ml-2 underline" onClick={handleUndo}>undo</button>
            </AlertDescription>
          </Alert>
        </div>
      )}
    </div>
  );
}
