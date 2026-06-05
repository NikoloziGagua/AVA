import { useEffect, useState, type ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { fetchMemory, type MemoryView, patchMemoryLine, postMemoryLine } from "../api.js";
import { SegmentedTabs } from "../components/ava/SegmentedTabs.js";

const CATEGORIES = ["all", "context", "people", "setup", "skills", "schedule", "preferences"] as const;
type Filter = typeof CATEGORIES[number];

export function MemoryScreen({ onClose }: { onClose: () => void }) {
  const [m, setM] = useState<MemoryView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cat, setCat] = useState<Filter>("all");
  const [showPersonality, setShowPersonality] = useState(false);
  const [showProjects, setShowProjects] = useState(false);
  const [newPref, setNewPref] = useState("");

  async function load() {
    try { setM(await fetchMemory()); }
    catch (e) { setErr(String(e)); }
  }
  useEffect(() => { load(); }, []);

  if (err) return <div className="p-4 text-red-400 text-sm">error: {err}</div>;
  if (!m) return <div className="p-4 text-white/50 text-sm">Loading memory…</div>;

  const obs = cat === "all" ? m.observations.lines : m.observations.lines.filter((l) => l.category === cat);

  return (
    <div
      className="no-scrollbar relative h-full overflow-y-auto text-white"
      style={{
        background:
          "radial-gradient(ellipse 70% 80% at 50% 0%, rgba(92,242,255,0.10), transparent 60%), radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px) 0 0 / 28px 28px, #000",
      }}
    >
      <header
        className="sticky top-0 z-10 flex items-center gap-2 px-4 py-4 h-16"
        style={{
          background: "rgba(0,0,0,0.55)",
          backdropFilter: "blur(20px) saturate(140%)",
          WebkitBackdropFilter: "blur(20px) saturate(140%)",
          borderBottom: "1px solid rgba(92,242,255,0.16)",
        }}
      >
        <button
          onClick={onClose}
          aria-label="back"
          className="w-9 h-9 rounded-full text-white/65 hover:text-white hover:bg-white/8 active:scale-95 flex items-center justify-center transition-all"
        >
          <ChevronLeft size={20} />
        </button>
        <div className="hud text-[13px] text-white/95">Memory</div>
      </header>

      <Section
        title="Personality"
        right={<span className="text-white/40 text-[10px]">{showPersonality ? "hide" : "show"}</span>}
        onClickHeader={() => setShowPersonality((v) => !v)}
      >
        {showPersonality && (
          <>
            <pre className="text-xs text-white/75 whitespace-pre-wrap leading-relaxed">{m.personality || "(empty)"}</pre>
            <div className="text-[10px] text-white/35 mt-2">Edit data/memory/personality.md directly to change.</div>
          </>
        )}
      </Section>

      <Section title="Preferences">
        <div className="space-y-1.5">
          {m.preferences.lines.length === 0 && (
            <div className="text-xs text-white/40">none yet.</div>
          )}
          {m.preferences.lines.map((line) => (
            <PreferenceRow
              key={line}
              line={line}
              onEdit={async (newLine) => {
                await patchMemoryLine({ file: "preferences", oldLine: line, newLine });
                await load();
              }}
              onDelete={async () => {
                await patchMemoryLine({ file: "preferences", oldLine: line });
                await load();
              }}
            />
          ))}
          <div className="flex gap-2 pt-2">
            <input
              value={newPref}
              onChange={(e) => setNewPref(e.target.value)}
              placeholder="Add a preference…"
              className="flex-1 bg-transparent border border-white/10 rounded-md px-2 py-1.5 text-xs text-white placeholder:text-white/40"
            />
            <button
              onClick={async () => {
                const v = newPref.trim();
                if (!v) return;
                await postMemoryLine(v);
                setNewPref("");
                await load();
              }}
              className="px-3 text-xs rounded-md"
              style={{ background: "var(--ac)", color: "#04222a" }}
            >
              Add
            </button>
          </div>
        </div>
      </Section>

      <Section title={`Observations (${m.observations.lines.length})`}>
        <div className="overflow-x-auto pb-2 mb-2 -mx-1 px-1">
          <SegmentedTabs<Filter>
            options={CATEGORIES.map((c) => ({ value: c, label: c }))}
            value={cat}
            onChange={setCat}
            layout="auto"
          />
        </div>
        <div className="space-y-1.5">
          {obs.length === 0 && <div className="text-xs text-white/40">none.</div>}
          {obs.map((l) => (
            <ObservationRow
              key={l.raw}
              line={l}
              onEdit={async (newLine) => {
                await patchMemoryLine({ file: "observations", oldLine: l.raw, newLine });
                await load();
              }}
              onDelete={async () => {
                await patchMemoryLine({ file: "observations", oldLine: l.raw });
                await load();
              }}
            />
          ))}
        </div>
      </Section>

      <Section
        title="Projects"
        right={<span className="text-white/40 text-[10px]">{showProjects ? "hide" : "show"}</span>}
        onClickHeader={() => setShowProjects((v) => !v)}
      >
        {showProjects && (
          <div className="space-y-2">
            {m.projects.length === 0 && <div className="text-xs text-white/40">no projects.</div>}
            {m.projects.map((p) => (
              <details key={p.slug} className="text-xs text-white/75">
                <summary className="cursor-pointer text-white/85">{p.slug}</summary>
                <pre className="whitespace-pre-wrap mt-1 text-white/60 pl-2 border-l border-white/10">
                  {p.body || "(empty)"}
                </pre>
              </details>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ title, right, onClickHeader, children }: {
  title: string;
  right?: ReactNode;
  onClickHeader?: () => void;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-white/5 px-4 py-3">
      <header
        className={"hud flex items-center justify-between text-white/55 text-xs mb-2 " + (onClickHeader ? "cursor-pointer" : "")}
        onClick={onClickHeader}
      >
        <span>{title}</span>
        {right}
      </header>
      {children}
    </section>
  );
}

function PreferenceRow({ line, onEdit, onDelete }: {
  line: string;
  onEdit: (s: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(line);
  if (editing) {
    return (
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="flex-1 bg-transparent border border-white/15 rounded-md px-2 py-1.5 text-xs"
        />
        <button onClick={async () => { setEditing(false); await onEdit(draft); }} className="text-xs px-2 rounded" style={{ background: "var(--ac)", color: "#04222a" }}>save</button>
        <button onClick={() => { setEditing(false); setDraft(line); }} className="text-xs px-2 rounded text-white/60">cancel</button>
      </div>
    );
  }
  return (
    <div className="group relative border border-white/8 rounded-md px-3 py-2 text-xs text-white/85 hover:border-[rgba(92,242,255,0.3)] transition-colors">
      {line}
      <span className="absolute right-2 top-1.5 hidden group-hover:flex gap-2 text-[10px] text-white/60">
        <button onClick={() => setEditing(true)}>edit</button>
        <button onClick={() => void onDelete()} className="text-red-400">delete</button>
      </span>
    </div>
  );
}

function ObservationRow({ line, onEdit, onDelete }: {
  line: MemoryView["observations"]["lines"][number];
  onEdit: (s: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(line.raw);

  const color =
    line.confidence === "high" ? "var(--conf-high)" :
    line.confidence === "medium" ? "var(--conf-med)" :
                                   "var(--conf-low)";

  if (editing) {
    return (
      <div className="flex gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          className="flex-1 bg-transparent border border-white/15 rounded-md px-2 py-1.5 text-xs"
        />
        <div className="flex flex-col gap-1">
          <button onClick={async () => { setEditing(false); await onEdit(draft); }} className="text-xs px-2 py-1 rounded" style={{ background: "var(--ac)", color: "#04222a" }}>save</button>
          <button onClick={() => { setEditing(false); setDraft(line.raw); }} className="text-xs px-2 py-1 rounded text-white/60">cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex items-start gap-2 border border-white/8 rounded-md px-3 py-2 text-xs text-white/85 hover:border-[rgba(92,242,255,0.3)] transition-colors">
      <span className="inline-block w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: color }} />
      <div className="flex-1">
        <div>{line.text}</div>
        <div className="text-[10px] text-white/35 mt-0.5">{line.category} · {line.date}</div>
      </div>
      <span className="hidden group-hover:flex gap-2 text-[10px] text-white/60 shrink-0">
        <button onClick={() => setEditing(true)}>edit</button>
        <button onClick={() => void onDelete()} className="text-red-400">delete</button>
      </span>
    </div>
  );
}
