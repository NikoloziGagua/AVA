import { useEffect, useState, useRef } from "react";
import { fetchRules, createRule, patchRule, deleteRuleApi, type RuleRow } from "../api.js";

export function RulesScreen({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<RuleRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const pollRef = useRef<number | null>(null);

  async function refresh() {
    try {
      const r = await fetchRules();
      setRows(r);
      const anyPending = r.some((x) => x.status === "pending");
      if (anyPending && pollRef.current == null) {
        const started = Date.now();
        pollRef.current = window.setInterval(async () => {
          try {
            const r2 = await fetchRules();
            setRows(r2);
            const stillPending = r2.some((x) => x.status === "pending");
            if (!stillPending || Date.now() - started > 30_000) {
              if (pollRef.current != null) window.clearInterval(pollRef.current);
              pollRef.current = null;
            }
          } catch {
            // best-effort
          }
        }, 2000);
      }
    } catch (e) {
      setErr(String(e));
    }
  }

  useEffect(() => {
    refresh();
    return () => {
      if (pollRef.current != null) window.clearInterval(pollRef.current);
    };
  }, []);

  async function add() {
    const text = draft.trim();
    if (!text) return;
    setAdding(true);
    try {
      await createRule(text);
      setDraft("");
      await refresh();
    } catch (e) {
      setErr(String(e));
    } finally {
      setAdding(false);
    }
  }

  async function toggle(rule: RuleRow) {
    await patchRule(rule.id, rule.enabled === 0);
    await refresh();
  }

  async function remove(rule: RuleRow) {
    await deleteRuleApi(rule.id);
    await refresh();
  }

  return (
    <div className="h-full flex flex-col bg-neutral-950 text-neutral-100">
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
        <button onClick={onClose} className="text-neutral-400">← back</button>
        <h1 className="text-base">Autonomy rules</h1>
        <div className="w-12" />
      </div>
      <div className="p-3 border-b border-neutral-800 space-y-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. never let shell delete files in C:/work without asking"
          className="w-full bg-neutral-900 border border-neutral-800 rounded p-2 text-sm h-20"
        />
        <button
          onClick={add}
          disabled={adding || !draft.trim()}
          className="bg-emerald-600 disabled:opacity-50 text-white text-sm px-3 py-1.5 rounded"
        >
          {adding ? "adding…" : "Add rule"}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {err && <div className="p-4 text-red-400 text-sm">error: {err}</div>}
        {!rows && !err && <div className="p-4 text-neutral-500 text-sm">loading…</div>}
        {rows?.length === 0 && <div className="p-4 text-neutral-500 text-sm">no rules yet.</div>}
        {rows?.map((r) => (
          <div key={r.id} className="px-4 py-3 border-b border-neutral-900 flex items-start gap-3">
            <input
              type="checkbox"
              checked={r.enabled === 1}
              onChange={() => toggle(r)}
              className="mt-1"
              aria-label="enabled"
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm whitespace-pre-wrap break-words">{r.source}</div>
              <div className="text-xs text-neutral-500 mt-1">
                {r.status === "pending" && <span className="text-yellow-400">parsing…</span>}
                {r.status === "active" && <span className="text-emerald-500">active</span>}
                {r.status === "failed" && <span className="text-red-400">parse failed</span>}
                <span className="ml-2">{new Date(r.created_at).toLocaleString()}</span>
              </div>
            </div>
            <button onClick={() => remove(r)} aria-label="delete" className="text-neutral-500 hover:text-red-400 px-2">
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
