import { useEffect, useMemo, useState } from "react";
import { Braces, LoaderCircle, Network, Plus, RefreshCw, Sparkles, WifiOff } from "lucide-react";
import { PanelSection, PanelShell } from "../components/ava/PanelShell.js";
import { ApiError } from "../api.js";
import {
  fetchVisualExplanation,
  fetchVisualExplanations,
  readCachedVisuals,
  type VisualExplanation,
} from "./api.js";
import { VisualExplanationViewer } from "./VisualExplanationViewer.js";

export function VisualsScreen({
  initialVisualId = null,
  onCreate,
}: {
  initialVisualId?: string | null;
  onCreate: (prompt: string) => void;
}) {
  const cached = useMemo(() => readCachedVisuals(), []);
  const [visuals, setVisuals] = useState<VisualExplanation[]>(cached);
  const [selectedId, setSelectedId] = useState<string | null>(initialVisualId ?? cached[0]?.id ?? null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      let next = await fetchVisualExplanations();
      if (initialVisualId && !next.some((visual) => visual.id === initialVisualId)) {
        const requested = await fetchVisualExplanation(initialVisualId);
        next = [requested, ...next];
      }
      setVisuals(next);
      setSelectedId((current) => current && next.some((visual) => visual.id === current) ? current : initialVisualId ?? next[0]?.id ?? null);
      setOffline(false);
    } catch (cause) {
      const fallback = readCachedVisuals();
      setVisuals(fallback);
      setSelectedId((current) => current && fallback.some((visual) => visual.id === current) ? current : fallback[0]?.id ?? null);
      setOffline(cause instanceof ApiError && cause.status === 0);
      if (!fallback.length) setError(cause instanceof Error ? cause.message : "Visual explanations could not be loaded.");
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [initialVisualId]);
  const selected = visuals.find((visual) => visual.id === selectedId) ?? null;
  const start = () => {
    const topic = prompt.trim() || "the system or process I describe next";
    onCreate(`Create and present a progressive visual explanation of ${topic}. Use stable Mermaid IDs, concise scenes, captions, highlights, transitions, interaction cues, and an accessible structure.`);
  };

  return (
    <PanelShell title="Visuals" grid>
      <PanelSection title="CREATE A VISUAL EXPLANATION" span="lg:col-span-12">
        <div className="flex flex-col gap-3 md:flex-row">
          <label className="sr-only" htmlFor="visual-topic">What should AVA explain visually?</label>
          <input
            id="visual-topic"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") start(); }}
            placeholder="A repository, request path, workflow or branching decision…"
            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-cyan-300/45"
          />
          <button type="button" onClick={start} className="btn-deck btn-primary flex items-center justify-center gap-2"><Sparkles size={14} /> Ask AVA to build it</button>
        </div>
        <p className="mt-3 text-xs leading-5 text-white/40">AVA creates validated canonical Mermaid plus a small scene storyboard, then opens the result here automatically.</p>
      </PanelSection>

      <PanelSection
        title="EXPLANATIONS"
        span="lg:col-span-3"
        right={<button type="button" aria-label="Refresh visuals" onClick={() => void load()} className="text-white/45 hover:text-cyan-200"><RefreshCw size={13} /></button>}
      >
        {offline && <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-200/15 bg-amber-300/[0.06] px-3 py-2 text-[11px] text-amber-100/70"><WifiOff size={13} /> Offline — cached visuals</div>}
        {loading && !visuals.length ? (
          <div className="flex items-center gap-2 py-8 text-sm text-white/40"><LoaderCircle size={15} className="animate-spin" /> Loading visuals…</div>
        ) : error ? (
          <div className="py-6 text-sm leading-6 text-red-100/70">{error}</div>
        ) : visuals.length ? (
          <div className="space-y-2">
            {visuals.map((visual) => (
              <button
                key={visual.id}
                type="button"
                onClick={() => setSelectedId(visual.id)}
                aria-current={visual.id === selectedId ? "true" : undefined}
                className={`w-full rounded-xl border px-3 py-3 text-left transition ${visual.id === selectedId ? "border-cyan-300/35 bg-cyan-300/[0.08]" : "border-white/[0.07] bg-white/[0.025] hover:border-white/15"}`}
              >
                <span className="flex items-center gap-2 text-sm font-medium text-white/85"><Network size={13} className="text-cyan-200/70" /> {visual.title}</span>
                <span className="mt-1 block line-clamp-2 text-[11px] leading-4 text-white/40">{visual.summary}</span>
                <span className="mt-2 block text-[9px] uppercase tracking-[0.16em] text-white/25">{visual.storyboard.scenes.length} scenes · schema {visual.schemaVersion}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="py-8 text-center">
            <Braces className="mx-auto text-white/25" size={24} />
            <p className="mt-3 text-sm text-white/50">No visuals yet.</p>
            <button type="button" onClick={start} className="btn-deck btn-ghost mt-4 inline-flex items-center gap-2"><Plus size={13} /> Create the first</button>
          </div>
        )}
      </PanelSection>

      <PanelSection title={selected ? selected.title.toUpperCase() : "VIEWER"} span="lg:col-span-9">
        {selected ? (
          <>
            <p className="mb-5 text-sm leading-6 text-white/55">{selected.summary}</p>
            <VisualExplanationViewer visual={selected} />
          </>
        ) : (
          <div className="flex min-h-[440px] items-center justify-center text-center text-sm text-white/35">Create or select a visual explanation to begin the walkthrough.</div>
        )}
      </PanelSection>
    </PanelShell>
  );
}

