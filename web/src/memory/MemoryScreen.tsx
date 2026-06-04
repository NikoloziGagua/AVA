import { useEffect, useState, type ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { fetchMemory, type MemoryView, patchMemoryLine, postMemoryLine } from "../api.js";
import { SegmentedTabs } from "../components/ava/SegmentedTabs.js";
import { useGsapReveal } from "../lib/useGsapReveal.js";

const CATEGORIES = ["all", "context", "people", "setup", "skills", "schedule", "preferences"] as const;
type Filter = typeof CATEGORIES[number];

export function MemoryScreen({ onClose }: { onClose: () => void }) {
  const [m, setM] = useState<MemoryView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cat, setCat] = useState<Filter>("all");
  const [showPersonality, setShowPersonality] = useState(false);
  const [showProjects, setShowProjects] = useState(false);
  const [newPref, setNewPref] = useState("");
  const shellRef = useGsapReveal([cat, showPersonality, showProjects, m?.observations.lines.length ?? 0]);

  async function load() {
    try { setM(await fetchMemory()); }
    catch (e) { setErr(String(e)); }
  }

  useEffect(() => { load(); }, []);

  if (err) {
    return <div ref={shellRef} className="ava-luxe-screen p-4 text-sm text-red-400">error: {err}</div>;
  }
  if (!m) {
    return <div ref={shellRef} className="ava-luxe-screen p-4 text-sm text-[var(--ava-fg-muted)]">Loading memory...</div>;
  }

  const obs = cat === "all" ? m.observations.lines : m.observations.lines.filter((l) => l.category === cat);

  return (
    <div ref={shellRef} className="ava-luxe-screen ava-luxe-scroll text-white">
      <header data-gsap-reveal className="ava-luxe-header">
        <button
          onClick={onClose}
          aria-label="back"
          className="ava-icon-button shrink-0"
        >
          <ChevronLeft size={20} />
        </button>
        <div>
          <div className="ava-kicker mb-1">vault</div>
          <div className="ava-luxe-title text-sm">Memory</div>
        </div>
      </header>

      <main className="relative z-10 space-y-3 p-4">
        <Section
          title="Personality"
          right={<span className="text-[10px] text-[var(--ava-fg-faint)]">{showPersonality ? "hide" : "show"}</span>}
          onClickHeader={() => setShowPersonality((v) => !v)}
        >
          {showPersonality && (
            <>
              <pre className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--ava-fg-muted)]">{m.personality || "(empty)"}</pre>
              <div className="mt-2 text-[10px] text-[var(--ava-fg-faint)]">Edit data/memory/personality.md directly to change.</div>
            </>
          )}
        </Section>

        <Section title="Preferences">
          <div className="space-y-2">
            {m.preferences.lines.length === 0 && (
              <div className="text-xs text-[var(--ava-fg-faint)]">none yet.</div>
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
                placeholder="Add a preference..."
                className="ava-luxe-field flex-1 px-2 py-1.5 text-xs"
              />
              <button
                onClick={async () => {
                  const v = newPref.trim();
                  if (!v) return;
                  await postMemoryLine(v);
                  setNewPref("");
                  await load();
                }}
                className="ava-primary-button px-3 text-xs"
              >
                Add
              </button>
            </div>
          </div>
        </Section>

        <Section title={`Observations (${m.observations.lines.length})`}>
          <div className="-mx-1 mb-2 overflow-x-auto px-1 pb-2">
            <SegmentedTabs<Filter>
              options={CATEGORIES.map((c) => ({ value: c, label: c }))}
              value={cat}
              onChange={setCat}
              layout="auto"
            />
          </div>
          <div className="space-y-2">
            {obs.length === 0 && <div className="text-xs text-[var(--ava-fg-faint)]">none.</div>}
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
          right={<span className="text-[10px] text-[var(--ava-fg-faint)]">{showProjects ? "hide" : "show"}</span>}
          onClickHeader={() => setShowProjects((v) => !v)}
        >
          {showProjects && (
            <div className="space-y-2">
              {m.projects.length === 0 && <div className="text-xs text-[var(--ava-fg-faint)]">no projects.</div>}
              {m.projects.map((p) => (
                <details key={p.slug} className="text-xs text-[var(--ava-fg-muted)]">
                  <summary className="cursor-pointer text-[var(--ava-ink)]">{p.slug}</summary>
                  <pre className="mt-1 whitespace-pre-wrap border-l border-[var(--ava-border)] pl-2 text-[var(--ava-fg-muted)]">
                    {p.body || "(empty)"}
                  </pre>
                </details>
              ))}
            </div>
          )}
        </Section>
      </main>
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
    <section data-gsap-reveal className="ava-luxe-section">
      <header
        className={"mb-2 flex items-center justify-between text-xs uppercase tracking-[0.18em] text-[var(--ava-fg-muted)] " + (onClickHeader ? "cursor-pointer" : "")}
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
          className="ava-luxe-field flex-1 px-2 py-1.5 text-xs"
        />
        <button onClick={async () => { setEditing(false); await onEdit(draft); }} className="ava-primary-button px-2 text-xs">save</button>
        <button onClick={() => { setEditing(false); setDraft(line); }} className="ava-secondary-button px-2 text-xs">cancel</button>
      </div>
    );
  }
  return (
    <div className="ava-luxe-row group relative px-3 py-2 text-xs text-[var(--ava-fg)]">
      {line}
      <span className="absolute right-2 top-1.5 hidden gap-2 text-[10px] text-[var(--ava-fg-muted)] group-hover:flex">
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
          className="ava-luxe-field flex-1 px-2 py-1.5 text-xs"
        />
        <div className="flex flex-col gap-1">
          <button onClick={async () => { setEditing(false); await onEdit(draft); }} className="ava-primary-button px-2 py-1 text-xs">save</button>
          <button onClick={() => { setEditing(false); setDraft(line.raw); }} className="ava-secondary-button px-2 py-1 text-xs">cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="ava-luxe-row group flex items-start gap-2 px-3 py-2 text-xs text-[var(--ava-fg)]">
      <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
      <div className="flex-1">
        <div>{line.text}</div>
        <div className="mt-1 text-[10px] text-[var(--ava-fg-faint)]">{line.category} / {line.date}</div>
      </div>
      <span className="hidden shrink-0 gap-2 text-[10px] text-[var(--ava-fg-muted)] group-hover:flex">
        <button onClick={() => setEditing(true)}>edit</button>
        <button onClick={() => void onDelete()} className="text-red-400">delete</button>
      </span>
    </div>
  );
}
