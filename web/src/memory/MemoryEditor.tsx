import { useEffect, useState } from "react";
import {
  fetchMemory, patchMemoryLine, postMemoryLine,
  type MemoryView,
} from "../api.js";

const CATEGORIES = [
  "all", "preferences", "context", "skills", "setup", "schedule", "people",
] as const;
type Filter = typeof CATEGORIES[number];

export function MemoryEditor({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<MemoryView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [newPref, setNewPref] = useState("");
  const [showPersonality, setShowPersonality] = useState(false);

  async function load() {
    try { setView(await fetchMemory()); }
    catch (e) { setErr(String(e)); }
  }

  useEffect(() => { load(); }, []);

  async function savePref(oldLine: string, newLine: string) {
    await patchMemoryLine({ file: "preferences", oldLine, newLine });
    setEditing(null);
    await load();
  }
  async function deletePref(oldLine: string) {
    await patchMemoryLine({ file: "preferences", oldLine });
    setEditing(null);
    await load();
  }
  async function addPref() {
    const v = newPref.trim();
    if (!v) return;
    await postMemoryLine(v);
    setNewPref("");
    await load();
  }
  async function saveObs(oldLine: string, newLine: string) {
    await patchMemoryLine({ file: "observations", oldLine, newLine });
    setEditing(null);
    await load();
  }
  async function deleteObs(oldLine: string) {
    await patchMemoryLine({ file: "observations", oldLine });
    setEditing(null);
    await load();
  }

  if (err) return (
    <div className="p-4 text-red-400 text-sm">error: {err}</div>
  );
  if (!view) return (
    <div className="p-4 text-neutral-500 text-sm">loading…</div>
  );

  const obs = filter === "all"
    ? view.observations.lines
    : view.observations.lines.filter((o) => o.category === filter);

  return (
    <div className="h-full flex flex-col bg-neutral-950 text-neutral-100">
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
        <button onClick={onClose} className="text-neutral-400">← back</button>
        <h1 className="text-base">Memory</h1>
        <div className="w-12" />
      </div>
      <div className="flex-1 overflow-y-auto">

        {/* Personality */}
        <section className="border-b border-neutral-800 p-3">
          <button onClick={() => setShowPersonality((x) => !x)}
            className="text-sm text-neutral-300">
            {showPersonality ? "▾" : "▸"} Personality
          </button>
          {showPersonality && (
            <>
              <pre className="text-xs whitespace-pre-wrap mt-2 text-neutral-300">
                {view.personality || "(empty)"}
              </pre>
              <div className="text-xs text-neutral-500 mt-1">
                Edit data/memory/personality.md directly to change.
              </div>
            </>
          )}
        </section>

        {/* Preferences */}
        <section className="border-b border-neutral-800 p-3">
          <h2 className="text-sm font-semibold mb-2">Preferences</h2>
          {view.preferences.lines.length === 0 && (
            <div className="text-xs text-neutral-500">none yet.</div>
          )}
          {view.preferences.lines.map((line, i) => (
            <div key={`pref-${i}`} className="flex items-start gap-2 py-1">
              {editing === `pref:${line}` ? (
                <>
                  <textarea value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    className="flex-1 bg-neutral-900 border border-neutral-800 rounded p-1 text-sm" />
                  <button onClick={() => savePref(line, draft)}
                    className="text-xs text-emerald-400 px-2">save</button>
                  <button onClick={() => setEditing(null)}
                    className="text-xs text-neutral-500 px-2">×</button>
                </>
              ) : (
                <>
                  <div className="flex-1 text-sm">{line}</div>
                  <button onClick={() => { setEditing(`pref:${line}`); setDraft(line); }}
                    aria-label="edit" className="text-neutral-500 hover:text-neutral-200 px-1">✏</button>
                  <button onClick={() => deletePref(line)}
                    aria-label="delete" className="text-neutral-500 hover:text-red-400 px-1">🗑</button>
                </>
              )}
            </div>
          ))}
          <div className="flex gap-2 mt-2">
            <input value={newPref}
              onChange={(e) => setNewPref(e.target.value)}
              placeholder="add a preference"
              className="flex-1 bg-neutral-900 border border-neutral-800 rounded p-1 text-sm" />
            <button onClick={addPref} className="text-xs text-emerald-400 px-2">Add</button>
          </div>
        </section>

        {/* Observations */}
        <section className="border-b border-neutral-800 p-3">
          <h2 className="text-sm font-semibold mb-2">Observations</h2>
          <div className="flex flex-wrap gap-1 mb-2">
            {CATEGORIES.map((c) => (
              <button key={c} onClick={() => setFilter(c)}
                className={`text-xs px-2 py-0.5 rounded border ${
                  filter === c
                    ? "bg-neutral-700 border-neutral-500 text-neutral-100"
                    : "bg-neutral-900 border-neutral-800 text-neutral-400"
                }`}>{c}</button>
            ))}
          </div>
          {obs.length === 0 && (
            <div className="text-xs text-neutral-500">none.</div>
          )}
          {obs.map((o, i) => (
            <div key={`obs-${i}`} className="py-1 border-t border-neutral-900 first:border-t-0">
              {editing === `obs:${o.raw}` ? (
                <div className="flex items-start gap-2">
                  <textarea value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    className="flex-1 bg-neutral-900 border border-neutral-800 rounded p-1 text-xs" />
                  <button onClick={() => saveObs(o.raw, draft)}
                    className="text-xs text-emerald-400 px-2">save</button>
                  <button onClick={() => setEditing(null)}
                    className="text-xs text-neutral-500 px-2">×</button>
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                    o.confidence === "high" ? "bg-emerald-700"
                      : o.confidence === "medium" ? "bg-yellow-700"
                      : "bg-neutral-700"
                  }`}>{o.confidence}</span>
                  <span className="text-[10px] text-neutral-500">{o.date}</span>
                  <span className="text-[10px] text-neutral-500">{o.category}</span>
                  <div className="flex-1 text-sm">{o.text}</div>
                  <button onClick={() => { setEditing(`obs:${o.raw}`); setDraft(o.raw); }}
                    aria-label="edit" className="text-neutral-500 hover:text-neutral-200 px-1">✏</button>
                  <button onClick={() => deleteObs(o.raw)}
                    aria-label="delete" className="text-neutral-500 hover:text-red-400 px-1">🗑</button>
                </div>
              )}
            </div>
          ))}
        </section>

        {/* Projects */}
        <section className="p-3">
          <h2 className="text-sm font-semibold mb-2">Projects</h2>
          {view.projects.length === 0 && (
            <div className="text-xs text-neutral-500">no projects.</div>
          )}
          {view.projects.map((p) => (
            <details key={p.slug} className="py-1">
              <summary className="text-sm cursor-pointer">{p.slug}</summary>
              <pre className="text-xs whitespace-pre-wrap mt-1 text-neutral-400">
                {p.body || "(empty)"}
              </pre>
            </details>
          ))}
        </section>
      </div>
    </div>
  );
}
