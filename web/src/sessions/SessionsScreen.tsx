import { useEffect, useState } from "react";
import { fetchSessions, type SessionRow } from "../api.js";

export function SessionsScreen({
  onOpen,
  onNew,
  onClose,
}: {
  onOpen: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchSessions().then(setRows).catch((e) => setErr(String(e)));
  }, []);

  return (
    <div className="h-full flex flex-col bg-neutral-950 text-neutral-100">
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
        <button onClick={onClose} className="text-neutral-400">← back</button>
        <h1 className="text-base">Sessions</h1>
        <button onClick={onNew} className="text-emerald-400">+ new</button>
      </div>
      <div className="no-scrollbar flex-1 overflow-y-auto">
        {err && <div className="p-4 text-red-400 text-sm">error: {err}</div>}
        {!rows && !err && <div className="p-4 text-neutral-500 text-sm">loading…</div>}
        {rows?.length === 0 && <div className="p-4 text-neutral-500 text-sm">no sessions yet.</div>}
        {rows?.map((s) => (
          <button
            key={s.id}
            onClick={() => onOpen(s.id)}
            className="w-full text-left px-4 py-3 border-b border-neutral-900 hover:bg-neutral-900"
          >
            <div className="text-sm truncate">{s.title ?? "(untitled)"}</div>
            <div className="text-xs text-neutral-500">
              {new Date(s.updated_at).toLocaleString()} · {s.status}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
