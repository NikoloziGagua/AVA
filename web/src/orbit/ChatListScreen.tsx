import { useEffect, useState } from "react";
import { ChevronLeft, Trash2, Plus } from "lucide-react";
import { api, fetchSessions, type SessionRow } from "../api.js";
import { Alert, AlertDescription } from "../components/ui/alert.js";

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
    <div className="relative h-full overflow-y-auto bg-black text-white">
      <header className="sticky top-0 z-10 flex items-center gap-2 px-4 py-3 border-b border-white/8 bg-black/80 backdrop-blur-sm">
        <button onClick={onClose} aria-label="back" className="text-white/70"><ChevronLeft size={20} /></button>
        <div className="text-sm font-medium">All chats</div>
        <button
          onClick={() => onOpenChat(null)}
          aria-label="new chat"
          className="ml-auto w-8 h-8 rounded-full border border-white/15 bg-white/5 text-white flex items-center justify-center hover:bg-white/10"
        >
          <Plus size={14} />
        </button>
      </header>

      <div className="px-4 py-3 space-y-1.5">
        {loading && <div className="text-xs text-white/40">Loading…</div>}
        {!loading && sessions.length === 0 && (
          <div className="text-xs text-white/40 py-6 text-center">No chats yet. Tap + to start one.</div>
        )}
        {sessions.map((s) => (
          <div
            key={s.id}
            className="group flex items-center gap-3 border border-white/8 rounded-md px-3 py-2.5 text-xs hover:border-white/20 hover:bg-white/3 cursor-pointer"
            onClick={() => onOpenChat(s.id)}
          >
            <div className="flex-1 min-w-0">
              <div className="text-white/90 truncate">{s.title ?? "Untitled"}</div>
              <div className="text-[10px] text-white/40 mt-0.5">
                {new Date(s.updated_at).toLocaleDateString()} · {new Date(s.updated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
            <button
              aria-label="delete"
              onClick={(e) => { e.stopPropagation(); handleDelete(s); }}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-white/45 hover:text-red-400 p-1.5"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      {pendingDelete && (
        <div className="sticky bottom-4 mx-4 z-20">
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
