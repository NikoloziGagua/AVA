import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Pencil, Trash2, Check, X, Plus, Pause, Play } from "lucide-react";
import { fetchMemory, type MemoryView, patchMemoryLine, postMemoryLine } from "../api.js";
import { SegmentedTabs } from "../components/ava/SegmentedTabs.js";
import { PanelShell, PanelSection } from "../components/ava/PanelShell.js";
import { MemoryBrain, type BrainNode } from "../components/ava/MemoryBrain.js";
import { PlaybooksSection } from "./PlaybooksSection.js";
import { WatchesSection } from "./WatchesSection.js";
import { PeopleSection } from "./PeopleSection.js";
import { useGSAP, gsap } from "../lib/gsap.js";
import { useReducedMotion } from "../lib/useReducedMotion.js";
import { isCoarsePointer } from "../lib/media.js";
import { hoverLift, press, settleText, EASE } from "../lib/deckMotion.js";

const CATEGORIES = ["all", "context", "people", "setup", "skills", "schedule", "preferences"] as const;
type Filter = typeof CATEGORIES[number];

// Closed (▸) and open (▾) chevron paths for the MorphSVG disclosure toggle.
const CHEVRON_CLOSED = "M5 3 L11 8 L5 13";
const CHEVRON_OPEN = "M3 5 L8 11 L13 5";

const CONF_COLOR = {
  high: "var(--conf-high)",
  medium: "var(--conf-med)",
  low: "var(--conf-low)",
} as const;

type ViewMode = "list" | "mind";

export function MemoryScreen(_props: { onClose?: () => void }) {
  const [m, setM] = useState<MemoryView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cat, setCat] = useState<Filter>("all");
  const [showPersonality, setShowPersonality] = useState(false);
  const [showProjects, setShowProjects] = useState(false);
  const [newPref, setNewPref] = useState("");
  // Mind (the 3D brain) is the front door — the list is the editing back office.
  const [view, setView] = useState<ViewMode>("mind");
  const [selected, setSelected] = useState<BrainNode | null>(null);

  async function load() {
    try { setM(await fetchMemory()); }
    catch (e) { setErr(String(e)); }
  }
  useEffect(() => { load(); }, []);

  // Plain (non-PanelShell) early returns so PanelShell mounts fresh with real
  // content and its enter stagger plays from the start.
  if (err) return <div className="flex h-full items-center justify-center bg-black text-sm text-red-400">error: {err}</div>;
  if (!m) return <div className="flex h-full items-center justify-center bg-black text-sm text-white/50">Loading memory…</div>;

  const obs = cat === "all" ? m.observations.lines : m.observations.lines.filter((l) => l.category === cat);

  return (
    <PanelShell title="Memory" grid>
      {/* View toggle — List (dashboard) vs Mind (3D memory brain). Spans the grid. */}
      <div className="lg:col-span-12 mb-1 flex justify-end" data-panel-section>
        <SegmentedTabs<ViewMode>
          options={[
            { value: "mind", label: "Mind" },
            { value: "list", label: "List" },
          ]}
          value={view}
          onChange={(v) => {
            setView(v);
            if (v === "list") setSelected(null);
          }}
          layout="auto"
        />
      </div>

      {view === "mind" ? (
        <MindStage memory={m} selected={selected} onSelect={setSelected} />
      ) : (
        <>
          {/* PRIMARY — the live observation feed (wide left column, the densest content). */}
          <PanelSection
        title="Observations"
        span="lg:col-span-7"
        right={<CountChip count={m.observations.lines.length} />}
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <SegmentedTabs<Filter>
            options={CATEGORIES.map((c) => ({ value: c, label: c }))}
            value={cat}
            onChange={setCat}
            layout="auto"
            className="flex-wrap"
          />
        </div>
        <ConfidenceLegend />
        <div className="space-y-2">
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
      </PanelSection>

      {/* SECONDARY — editable preferences (top of the right column). */}
      <PanelSection
        title="Preferences"
        span="lg:col-span-5"
        right={<CountChip count={m.preferences.lines.length} />}
      >
        <div className="space-y-2">
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
          <NewPreferenceInput
            value={newPref}
            onChange={setNewPref}
            onAdd={async () => {
              const v = newPref.trim();
              if (!v) return;
              await postMemoryLine(v);
              setNewPref("");
              await load();
            }}
          />
        </div>
      </PanelSection>

      {/* TERTIARY — collapsible reference (Personality + Projects) span the lower row. */}
      <PanelSection
        title="Personality"
        span="lg:col-span-6"
        right={
          <span className="hud text-[10px] tracking-[0.18em] text-[var(--ac)]/80">
            {showPersonality ? "hide" : "show"}
          </span>
        }
        onClickHeader={() => setShowPersonality((v) => !v)}
      >
        {showPersonality ? (
          <Reveal>
            <pre className="whitespace-pre-wrap text-xs leading-relaxed text-white/75">{m.personality || "(empty)"}</pre>
            <div className="mt-3 hud text-[9px] tracking-[0.16em] text-white/30">
              Edit data/memory/personality.md directly to change.
            </div>
          </Reveal>
        ) : (
          <div className="text-xs text-white/40">Ava's tone &amp; voice. Tap to reveal.</div>
        )}
      </PanelSection>

      <PanelSection
        title="Projects"
        span="lg:col-span-6"
        right={
          <span className="flex items-center gap-2">
            <CountChip count={m.projects.length} />
            <span className="hud text-[10px] tracking-[0.18em] text-[var(--ac)]/80">
              {showProjects ? "hide" : "show"}
            </span>
          </span>
        }
        onClickHeader={() => setShowProjects((v) => !v)}
      >
        {showProjects ? (
          <Reveal className="space-y-1.5">
            {m.projects.length === 0 && <div className="text-xs text-white/40">no projects.</div>}
            {m.projects.map((p) => (
              <ProjectDisclosure key={p.slug} slug={p.slug} body={p.body} />
            ))}
          </Reveal>
        ) : (
          <div className="text-xs text-white/40">Known project workspaces. Tap to reveal.</div>
        )}
      </PanelSection>
        </>
      )}

      {/* Learning + monitoring + reach read surfaces — Ava's playbooks, standing
          watches, and people map stay visible in BOTH views (below the brain in
          Mind mode). */}
      <PlaybooksSection />
      <WatchesSection />
      <PeopleSection />
    </PanelShell>
  );
}

/**
 * "Mind" mode: the 3D memory brain in a tall full-width stage, with a node
 * inspector that overlays the top-right corner when a node is selected. The brain
 * computes its layout once and disposes its GL resources on unmount.
 */
function MindStage({
  memory,
  selected,
  onSelect,
}: {
  memory: MemoryView;
  selected: BrainNode | null;
  onSelect: (n: BrainNode | null) => void;
}) {
  const [spinning, setSpinning] = useState(true);
  const items =
    memory.observations.lines.length + memory.preferences.lines.length + memory.projects.length;
  const hubs = new Set(memory.observations.lines.map((l) => l.category)).size + 2; // + preferences/projects
  return (
    <div className="lg:col-span-12" data-panel-section>
      {/* No framing box — the network floats free over the panel backdrop, bigger. */}
      <div
        className="relative w-full overflow-hidden"
        style={{ height: "min(82vh, 900px)" }}
      >
        {/* Stage atmosphere BEHIND the canvas: a deep radial well that grounds the
            network in space + a faint cyan breath at its heart. Pure CSS, static. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 62% 56% at 50% 46%, rgba(92,242,255,0.055), transparent 62%)," +
              "radial-gradient(ellipse 85% 80% at 50% 50%, transparent 38%, rgba(0,0,0,0.55) 86%)",
          }}
        />
        <MemoryBrain memory={memory} onSelect={onSelect} spinning={spinning} />

        {/* Telemetry rail, top-left — what the cortex is holding right now. */}
        <div className="pointer-events-none absolute left-4 top-3 hud text-[9px] tracking-[0.22em] text-white/40">
          <span style={{ color: "var(--ac)" }}>◉</span> neural map · {items} memories · {hubs} clusters
        </div>

        {/* Hint rail, bottom-left — zoom gesture depends on the pointer in hand. */}
        <div className="pointer-events-none absolute bottom-3 left-4 hud text-[9px] tracking-[0.18em] text-white/35">
          drag to rotate · {isCoarsePointer() ? "pinch" : "scroll"} to zoom · tap a node
        </div>

        {/* Spin toggle, bottom-right. */}
        <button
          onClick={() => setSpinning((s) => !s)}
          aria-label={spinning ? "pause rotation" : "resume rotation"}
          aria-pressed={!spinning}
          className="btn-deck btn-ghost absolute bottom-3 right-4 z-10 h-7 gap-1.5 px-2.5 text-[10px]"
        >
          {spinning ? <Pause size={12} /> : <Play size={12} />}
          <span>{spinning ? "Pause" : "Spin"}</span>
        </button>

        {/* Inspector card, top-right corner, shown on selection. */}
        {selected && <NodeInspector node={selected} onClose={() => onSelect(null)} />}
      </div>
    </div>
  );
}

const KIND_LABEL: Record<BrainNode["kind"], string> = {
  core: "core",
  category: "hub",
  observation: "observation",
  preference: "preference",
  project: "project",
};

/** The selected-node detail card overlaying the brain stage. */
function NodeInspector({ node, onClose }: { node: BrainNode; onClose: () => void }) {
  const confColor = node.confidence ? CONF_COLOR[node.confidence] : null;
  return (
    // Sleek technical HUD panel (not the bubbly .bg-card): sharp 7px corners, a flat deep
    // body, a thin cyan top accent bar, restrained glow.
    <div
      className="absolute right-4 top-4 z-10 w-[min(20rem,calc(100%-2rem))] p-4"
      style={{
        borderRadius: "7px",
        background: "rgba(8,12,18,0.86)",
        border: "1px solid rgba(92,242,255,0.22)",
        boxShadow: "0 18px 50px -26px rgba(0,0,0,0.9)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ background: "linear-gradient(90deg, transparent, var(--ac), transparent)" }}
      />
      <div className="mb-2 flex items-start justify-between gap-3">
        <span className="hud text-[10px] tracking-[0.18em] text-[var(--ac)]/85">
          {KIND_LABEL[node.kind]}
        </span>
        <button onClick={onClose} className="btn-deck btn-ghost h-7 px-2" aria-label="close inspector">
          <X size={14} strokeWidth={2.5} />
        </button>
      </div>
      <div className="text-sm font-medium leading-snug text-white/90">{node.label}</div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 hud text-[9px] tracking-[0.16em] text-white/40">
        {node.category && <span>{node.category}</span>}
        {confColor && (
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: confColor, boxShadow: `0 0 6px ${confColor}` }}
            />
            {node.confidence}
          </span>
        )}
        {node.date && <span>{node.date}</span>}
      </div>
      {node.text && node.text !== node.label && (
        <pre className="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap border-l border-[rgba(92,242,255,0.25)] pl-3 text-[11px] leading-relaxed text-white/65">
          {node.text}
        </pre>
      )}
    </div>
  );
}

/** A small, reduced-gated fade+rise reveal for disclosure content. */
function Reveal({ children, className }: { children: React.ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const el = ref.current;
    if (!el || reduced) return;
    gsap.from(el, { opacity: 0, y: 8, filter: "blur(6px)", duration: 0.4, ease: EASE, clearProps: "filter" });
  }, { dependencies: [reduced] });
  return <div ref={ref} className={className}>{children}</div>;
}

/** Observations count, scramble-settling the digits whenever the count changes. */
function CountChip({ count }: { count: number }) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  useGSAP(() => {
    if (ref.current) settleText(ref.current, String(count), reduced);
  }, { dependencies: [count, reduced] });
  return (
    <span className="chip chip-ac">
      <span ref={ref}>{count}</span>
    </span>
  );
}

/** HIGH / MED / LOW confidence swatch key, drawn above the observation list. */
function ConfidenceLegend() {
  return (
    <div className="mb-3 flex items-center gap-4 hud text-[9px] tracking-[0.18em] text-white/40">
      {([["HIGH", CONF_COLOR.high], ["MED", CONF_COLOR.medium], ["LOW", CONF_COLOR.low]] as const).map(
        ([label, color]) => (
          <span key={label} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: color, boxShadow: `0 0 6px ${color}` }}
            />
            {label}
          </span>
        ),
      )}
    </div>
  );
}

/** The "Add a preference" inline composer with primary button + press feedback. */
function NewPreferenceInput({ value, onChange, onAdd }: {
  value: string;
  onChange: (s: string) => void;
  onAdd: () => Promise<void> | void;
}) {
  const reduced = useReducedMotion();
  const { contextSafe } = useGSAP();
  return (
    <div className="flex gap-2 pt-2">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") void onAdd(); }}
        placeholder="Add a preference…"
        className="h-9 flex-1 rounded-md border border-white/10 bg-white/[0.03] px-3 text-xs text-white placeholder:text-white/40 transition-colors focus:border-[rgba(92,242,255,0.4)] focus:outline-none"
      />
      <button
        onClick={() => void onAdd()}
        onPointerDown={contextSafe((e: React.PointerEvent<HTMLButtonElement>) => press(e.currentTarget, true, reduced))}
        onPointerUp={contextSafe((e: React.PointerEvent<HTMLButtonElement>) => press(e.currentTarget, false, reduced))}
        onPointerLeave={contextSafe((e: React.PointerEvent<HTMLButtonElement>) => press(e.currentTarget, false, reduced))}
        className="btn-deck btn-primary"
      >
        <Plus size={14} strokeWidth={2.5} /> Add
      </button>
    </div>
  );
}

function PreferenceRow({ line, onEdit, onDelete }: {
  line: string;
  onEdit: (s: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const reduced = useReducedMotion();
  const { contextSafe } = useGSAP();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(line);

  if (editing) {
    return (
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { setEditing(false); void onEdit(draft); } if (e.key === "Escape") { setEditing(false); setDraft(line); } }}
          className="h-9 flex-1 rounded-md border border-white/15 bg-white/[0.03] px-3 text-xs text-white focus:border-[rgba(92,242,255,0.4)] focus:outline-none"
          autoFocus
        />
        <button onClick={async () => { setEditing(false); await onEdit(draft); }} className="btn-deck btn-primary px-3" aria-label="save">
          <Check size={14} strokeWidth={2.5} />
        </button>
        <button onClick={() => { setEditing(false); setDraft(line); }} className="btn-deck btn-ghost px-3" aria-label="cancel">
          <X size={14} strokeWidth={2.5} />
        </button>
      </div>
    );
  }

  return (
    <div
      className="lg-slab lg-sweep group relative rounded-xl px-4 py-2.5 text-xs text-white/85"
      style={{ "--sweep-x": "-130%" } as CSSProperties}
      onMouseEnter={contextSafe((e: React.MouseEvent<HTMLDivElement>) => hoverLift(e.currentTarget, true, reduced))}
      onMouseLeave={contextSafe((e: React.MouseEvent<HTMLDivElement>) => hoverLift(e.currentTarget, false, reduced))}
    >
      <span className="block pr-16">{line}</span>
      <span className="absolute right-3 top-1/2 flex -translate-y-1/2 gap-1 opacity-40 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <button onClick={() => setEditing(true)} className="btn-deck btn-ghost h-7 px-2" aria-label="edit">
          <Pencil size={14} />
        </button>
        <button onClick={() => void onDelete()} className="btn-deck btn-danger h-7 px-2" aria-label="delete">
          <Trash2 size={14} />
        </button>
      </span>
    </div>
  );
}

function ObservationRow({ line, onEdit, onDelete }: {
  line: MemoryView["observations"]["lines"][number];
  onEdit: (s: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const reduced = useReducedMotion();
  const { contextSafe } = useGSAP();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(line.raw);

  const color = CONF_COLOR[line.confidence];

  if (editing) {
    return (
      <div className="flex gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          className="flex-1 rounded-md border border-white/15 bg-white/[0.03] px-3 py-2 text-xs text-white focus:border-[rgba(92,242,255,0.4)] focus:outline-none"
          autoFocus
        />
        <div className="flex flex-col gap-1">
          <button onClick={async () => { setEditing(false); await onEdit(draft); }} className="btn-deck btn-primary h-8 px-2" aria-label="save">
            <Check size={14} strokeWidth={2.5} />
          </button>
          <button onClick={() => { setEditing(false); setDraft(line.raw); }} className="btn-deck btn-ghost h-8 px-2" aria-label="cancel">
            <X size={14} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="lg-slab lg-sweep group flex items-start gap-3 rounded-xl px-4 py-2.5 text-xs text-white/85"
      style={{ "--sweep-x": "-130%" } as CSSProperties}
      onMouseEnter={contextSafe((e: React.MouseEvent<HTMLDivElement>) => hoverLift(e.currentTarget, true, reduced))}
      onMouseLeave={contextSafe((e: React.MouseEvent<HTMLDivElement>) => hoverLift(e.currentTarget, false, reduced))}
    >
      <span
        className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full"
        style={{ background: color, boxShadow: `0 0 6px ${color}` }}
      />
      <div className="min-w-0 flex-1">
        <div className="leading-relaxed">{line.text}</div>
        <div className="mt-1 hud text-[9px] tracking-[0.16em] text-white/35">{line.category} · {line.date}</div>
      </div>
      <span className="flex shrink-0 gap-1 opacity-40 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <button onClick={() => setEditing(true)} className="btn-deck btn-ghost h-7 px-2" aria-label="edit">
          <Pencil size={14} />
        </button>
        <button onClick={() => void onDelete()} className="btn-deck btn-danger h-7 px-2" aria-label="delete">
          <Trash2 size={14} />
        </button>
      </span>
    </div>
  );
}

/**
 * Custom project disclosure (replaces native <details>): a header button with a
 * MorphSVG chevron that morphs ▸↔▾ on toggle, with a Flip reflow of the siblings.
 * Same open/close semantics as the old <summary>. Reduced motion → instant swap.
 */
function ProjectDisclosure({ slug, body }: { slug: string; body: string }) {
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const chevronRef = useRef<SVGPathElement>(null);

  useGSAP(() => {
    const path = chevronRef.current;
    if (!path) return;
    const target = open ? CHEVRON_OPEN : CHEVRON_CLOSED;
    if (reduced) { gsap.set(path, { attr: { d: target } }); return; }
    gsap.to(path, { duration: 0.4, ease: EASE, morphSVG: target });
  }, { dependencies: [open, reduced] });

  return (
    <div className="lg-slab overflow-hidden rounded-xl">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-white/85 transition-colors hover:text-white"
        aria-expanded={open}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" className="shrink-0 text-[var(--ac)]" aria-hidden>
          <path
            ref={chevronRef}
            d={CHEVRON_CLOSED}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="truncate">{slug}</span>
      </button>
      {open && (
        <pre className="ml-[1.85rem] mr-3 mb-2 whitespace-pre-wrap border-l border-[rgba(92,242,255,0.25)] pl-3 text-[11px] leading-relaxed text-white/60">
          {body || "(empty)"}
        </pre>
      )}
    </div>
  );
}
