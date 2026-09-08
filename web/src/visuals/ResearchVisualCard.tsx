import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, BookOpen, ChevronDown, Download, ExternalLink, FileImage, Focus, Maximize2, MessageCircleQuestion, Paperclip, ShieldCheck, Sparkles, X } from "lucide-react";
import { useReducedMotion } from "../lib/useReducedMotion.js";
import { exportVisualCanvas } from "./render.js";
import { ResearchVisualCanvas } from "./ResearchVisualCanvas.js";
import { researchEntityLabel, type ResearchEvidenceRefs, type ResearchVisualMessage, type VisualMessage, type VisualMessageContext } from "./types.js";

type Props = {
  visual: ResearchVisualMessage;
  mode?: "inline" | "workspace";
  onSemanticAction?: (context: VisualMessageContext, visual: VisualMessage) => void;
  exporter?: typeof exportVisualCanvas;
  canvasComponent?: typeof ResearchVisualCanvas;
};

type BoundaryProps = { resetKey: string; fallback: ReactNode; children: ReactNode };
type BoundaryState = { failed: boolean };

class ResearchCanvasBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false };
  static getDerivedStateFromError(): BoundaryState { return { failed: true }; }
  componentDidUpdate(previous: BoundaryProps): void {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }
  render(): ReactNode { return this.state.failed ? this.props.fallback : this.props.children; }
}

const FORM_LABEL = {
  geographic_map: "Geographic map", timeline: "Timeline", evidence_matrix: "Evidence-gap matrix",
  claim_evidence_graph: "Claim-evidence graph", chart: "Evidence chart", process: "Process map",
} as const;

function startScene(visual: ResearchVisualMessage) {
  return Math.max(0, visual.storyboard.scenes.findIndex((scene) => scene.id === visual.storyboard.startSceneId));
}

function entityFor(visual: ResearchVisualMessage, id: string): (ResearchEvidenceRefs & { id: string; label: string; detail: string }) | null {
  const model = visual.semanticModel;
  if (model.kind === "geographic_map") {
    const item = [...model.locations, ...model.routes, ...model.regions].find((value) => value.id === id);
    if (!item) return null;
    return { ...item, detail: "description" in item ? item.description : "bounds" in item ? "Approximate geographic region" : `${item.direction} route` };
  }
  if (model.kind === "timeline") { const item = model.events.find((value) => value.id === id); return item ? { ...item, detail: `${item.dateLabel}: ${item.description}` } : null; }
  if (model.kind === "evidence_matrix") { const item = model.cells.find((value) => value.id === id); return item ? { ...item, detail: item.detail } : null; }
  if (model.kind === "claim_evidence_graph") { const item = model.nodes.find((value) => value.id === id); return item ? { ...item, detail: item.description } : null; }
  if (model.kind === "chart") { const item = model.points.find((value) => value.id === id); return item ? { ...item, detail: item.value === null ? "Value unavailable" : `${item.value} ${model.unit}${item.low !== null && item.high !== null ? ` (range ${item.low}–${item.high})` : ""}` } : null; }
  const item = model.elements.find((value) => value.id === id); return item ? { ...item, detail: item.description } : null;
}

function statusClass(status: string) {
  return status === "supported" ? "border-emerald-300/20 bg-emerald-300/[0.07] text-emerald-50/75"
    : status === "gap" || status === "missing_evidence" ? "border-white/10 bg-white/[0.03] text-white/45"
    : "border-amber-300/20 bg-amber-300/[0.07] text-amber-50/75";
}

export function ResearchVisualCard({ visual, mode = "inline", onSemanticAction, exporter = exportVisualCanvas, canvasComponent: Canvas = ResearchVisualCanvas }: Props) {
  const reducedMotion = useReducedMotion();
  const [sceneIndex, setSceneIndex] = useState(() => startScene(visual));
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [exporting, setExporting] = useState<"svg" | "png" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const returnRef = useRef<{ scroller: HTMLElement | null; scrollTop: number } | null>(null);
  const scene = visual.storyboard.scenes[sceneIndex] ?? visual.storyboard.scenes[0]!;
  const sources = useMemo(() => new Map(visual.sources.map((source) => [source.id, source])), [visual.sources]);
  const claims = useMemo(() => new Map(visual.claims.map((claim) => [claim.id, claim])), [visual.claims]);
  const selected = selectedIds.map((id) => entityFor(visual, id)).filter((item): item is NonNullable<typeof item> => Boolean(item));

  useEffect(() => { setSceneIndex(startScene(visual)); setSelectedIds([]); }, [visual.visualMessageId, visual.revision]);
  useEffect(() => { setSelectedIds((current) => current.filter((id) => scene.entityIds.includes(id))); }, [scene.id, scene.entityIds]);
  useEffect(() => {
    if (!expanded) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setExpanded(false); };
    document.addEventListener("keydown", escape);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => rootRef.current?.focus());
    return () => { document.removeEventListener("keydown", escape); document.body.style.overflow = overflow; };
  }, [expanded]);

  const move = (next: number) => setSceneIndex(Math.max(0, Math.min(visual.storyboard.scenes.length - 1, next)));
  const keyNav = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "ArrowRight") { event.preventDefault(); move(sceneIndex + 1); }
    if (event.key === "ArrowLeft") { event.preventDefault(); move(sceneIndex - 1); }
    if (event.key === "Home") { event.preventDefault(); move(0); }
    if (event.key === "End") { event.preventDefault(); move(visual.storyboard.scenes.length - 1); }
    if (event.key === "Escape") setSelectedIds([]);
  };
  const invoke = (action: VisualMessageContext["action"]) => {
    const selection = selectedIds.filter((id) => scene.entityIds.includes(id));
    if ((action === "branch" || action === "attach") && !selection.length) return;
    onSemanticAction?.({ visualMessageId: visual.visualMessageId, revision: visual.revision, action, sceneId: scene.id, selectedElementIds: selection }, visual);
  };
  const runExport = async (format: "svg" | "png") => {
    if (!canvasRef.current || exporting) return;
    setExportError(null); setExporting(format);
    try { await exporter(canvasRef.current, format, visual.title, scene.title); }
    catch (error) { setExportError(error instanceof Error ? error.message : `${format.toUpperCase()} export failed.`); }
    finally { setExporting(null); }
  };
  const openExpanded = () => {
    const scroller = rootRef.current?.closest(".soft-scrollbar") as HTMLElement | null;
    returnRef.current = { scroller, scrollTop: scroller?.scrollTop ?? 0 };
    setExpanded(true);
  };
  const closeExpanded = () => {
    setExpanded(false);
    requestAnimationFrame(() => { const saved = returnRef.current; if (saved?.scroller) saved.scroller.scrollTop = saved.scrollTop; rootRef.current?.focus(); });
  };

  const content = (overlay: boolean) => <div ref={rootRef} tabIndex={0} onKeyDown={keyNav} data-testid="research-visual-card" data-visual-form={visual.diagramKind} aria-label={`${visual.title}, ${FORM_LABEL[visual.diagramKind]}, revision ${visual.revision}`} className={`outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 ${overlay ? "flex h-full min-h-0 flex-col" : ""}`}>
    <header className="relative overflow-hidden rounded-xl border border-cyan-200/12 bg-gradient-to-br from-cyan-300/[0.10] via-purple-300/[0.035] to-transparent p-3 sm:p-4">
      <div className="pointer-events-none absolute -right-8 -top-16 h-40 w-40 rounded-full bg-cyan-300/12 blur-3xl" />
      <div className="relative flex items-start justify-between gap-3"><div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><span className="chip chip-ac"><Sparkles size={10} /> {FORM_LABEL[visual.diagramKind]}</span><span className="hud text-[9px] text-white/35">{visual.sources.length} sources</span><span className="hud text-[9px] text-white/35">{visual.claims.length} claims</span><span className="hud text-[9px] text-white/35">Revision {visual.revision}</span></div>
        <h3 className="mt-2 text-lg font-semibold text-white sm:text-xl">{visual.title}</h3><p className="mt-1 max-w-4xl text-[13px] leading-5 text-white/58">{visual.summary}</p>
        <p className="mt-2 text-[10px] leading-4 text-cyan-100/48">{visual.selection.userSelected ? "User-selected form" : "AVA recommendation"}: {visual.selection.reason}</p>
      </div><div className="visual-export-ignore flex gap-1.5">{!overlay && mode === "inline" && <button type="button" onClick={openExpanded} aria-label="Expand research visual inside AVA" className="btn-deck btn-ghost p-2"><Maximize2 size={14} /></button>}{overlay && <button type="button" onClick={closeExpanded} aria-label="Close expanded research visual" className="btn-deck btn-ghost p-2"><X size={15} /></button>}</div></div>
    </header>

    <div className="visual-export-ignore mt-3 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Research visual scenes">{visual.storyboard.scenes.map((item, index) => <button key={item.id} type="button" role="tab" aria-selected={index === sceneIndex} onClick={() => move(index)} className={`min-w-max rounded-lg border px-3 py-2 text-[11px] ${index === sceneIndex ? "border-cyan-300/45 bg-cyan-300/10 text-cyan-50" : "border-white/8 bg-white/[0.02] text-white/42 hover:text-white/70"}`}><span className="mr-2 font-mono text-[9px] opacity-60">{index + 1}</span>{item.title}</button>)}</div>

    <section className={`mt-2 ${overlay ? "flex min-h-0 flex-1 flex-col" : ""}`} aria-label={`Scene ${sceneIndex + 1}: ${scene.title}`}>
      <div className="mb-2 flex items-end justify-between gap-3 px-1"><div><p className="text-sm font-medium text-white/82">{scene.caption}</p>{scene.interactionCue && <p className="mt-0.5 text-[11px] text-cyan-100/48">{scene.interactionCue}</p>}<div className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Sources for this scene">{scene.sourceIds.map((id) => sources.get(id)).filter(Boolean).map((source) => <a key={source!.id} href={source!.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md border border-cyan-300/12 bg-cyan-300/[0.04] px-1.5 py-0.5 text-[9px] text-cyan-100/55 hover:text-cyan-50">{source!.title}<ExternalLink size={8} /></a>)}</div></div><span className="hud text-[8px] text-white/28">Select evidence for details</span></div>
      <div className={`relative overflow-hidden rounded-xl border border-cyan-200/12 bg-[#050b10] ${overlay ? "min-h-[380px] flex-1" : "h-[390px] sm:h-[460px]"}`}>
        <ResearchCanvasBoundary
          resetKey={`${visual.visualMessageId}:${visual.revision}:${scene.id}`}
          fallback={<div role="alert" className="flex h-full items-center justify-center overflow-auto p-6"><div className="max-w-2xl rounded-xl border border-amber-200/20 bg-amber-300/[0.06] p-4 text-sm text-amber-50/75"><strong>Interactive visual unavailable.</strong><p className="mt-2 text-xs leading-5">The validated text fallback remains available below. No data was discarded.</p><ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-white/55">{scene.entityIds.map((id) => <li key={id}>{researchEntityLabel(visual.semanticModel, id)}</li>)}</ul></div></div>}
        >
          <Canvas ref={canvasRef} visual={visual} scene={scene} selectedIds={selectedIds} onSelectedIdsChange={setSelectedIds} reducedMotion={reducedMotion} expanded={overlay} />
        </ResearchCanvasBoundary>
      </div>
    </section>

    <div className="visual-export-ignore mt-3 grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto]">
      <div className="rounded-xl border border-white/8 bg-white/[0.025] px-3 py-2.5" aria-live="polite">{selected.length ? <div className="space-y-3">{selected.map((entity) => <div key={entity.id}><div className="flex flex-wrap items-center gap-2"><Focus size={12} className="text-cyan-200" /><strong className="text-xs text-white/85">{entity.label}</strong><span className={`rounded-full border px-2 py-0.5 text-[9px] ${statusClass(entity.evidenceStatus)}`}>{entity.evidenceStatus} · {entity.confidence}</span></div><p className="mt-1 text-[11px] leading-5 text-white/48">{entity.detail}</p>{entity.uncertainty && <p className="mt-1 text-[10px] text-amber-100/60">Uncertainty: {entity.uncertainty}</p>}<div className="mt-2 flex flex-wrap gap-1.5">{entity.claimIds.map((id) => claims.get(id)).filter(Boolean).map((claim) => <span key={claim!.id} className="rounded-md border border-white/8 bg-black/20 px-2 py-1 text-[9px] text-white/48">Claim: {claim!.text}</span>)}{entity.sourceIds.map((id) => sources.get(id)).filter(Boolean).map((source) => <a key={source!.id} href={source!.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md border border-cyan-300/15 bg-cyan-300/[0.05] px-2 py-1 text-[9px] text-cyan-100/65 hover:text-cyan-50">{source!.title}<ExternalLink size={9} /></a>)}</div></div>)}</div> : <p className="flex items-center gap-2 text-[11px] text-white/40"><Focus size={13} /> Select a visual entity to inspect its claims, confidence, uncertainty and sources.</p>}</div>
      {onSemanticAction && <div className="flex flex-wrap items-center gap-1.5"><button type="button" onClick={() => invoke("explain")} className="btn-deck btn-ghost"><MessageCircleQuestion size={13} /> Explain scene</button><button type="button" disabled={!selected.length} onClick={() => invoke("branch")} className="btn-deck btn-primary disabled:opacity-35">Ask about selection</button><button type="button" disabled={!selected.length} onClick={() => invoke("attach")} className="btn-deck btn-ghost disabled:opacity-35"><Paperclip size={13} /> Attach</button></div>}
    </div>

    <div className="visual-export-ignore mt-3 flex items-center gap-2"><button type="button" disabled={sceneIndex === 0} onClick={() => move(sceneIndex - 1)} className="btn-deck btn-ghost disabled:opacity-30"><ArrowLeft size={13} /> Previous</button><div className="h-px flex-1 bg-white/8" /><span className="hud text-[9px] text-white/30">Scene {sceneIndex + 1} / {visual.storyboard.scenes.length}</span><div className="h-px flex-1 bg-white/8" /><button type="button" disabled={sceneIndex === visual.storyboard.scenes.length - 1} onClick={() => move(sceneIndex + 1)} className="btn-deck btn-ghost disabled:opacity-30">Next <ArrowRight size={13} /></button></div>

    <details className="visual-export-ignore mt-3 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5"><summary className="cursor-pointer list-none text-xs font-medium text-white/58"><span className="flex items-center gap-2"><BookOpen size={13} /> Synthesis, method and limitations <ChevronDown size={12} /></span></summary><div className="mt-3 grid gap-4 text-xs leading-5 text-white/55 md:grid-cols-3"><div><h4 className="font-semibold text-white/80">Synthesis</h4><p className="mt-1 whitespace-pre-wrap">{visual.synthesis}</p></div><div><h4 className="font-semibold text-white/80">Methodology</h4><p className="mt-1 whitespace-pre-wrap">{visual.methodology}</p></div><div><h4 className="font-semibold text-white/80">Limitations</h4>{visual.limitations.length ? <ul className="mt-1 list-disc space-y-1 pl-4">{visual.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className="mt-1">No additional limitations recorded.</p>}</div></div></details>
    <details className="visual-export-ignore mt-2 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5"><summary className="cursor-pointer list-none text-xs font-medium text-white/58"><span className="flex items-center gap-2"><ShieldCheck size={13} /> Accessible text and source panel <ChevronDown size={12} /></span></summary><div className="mt-3 space-y-4 text-xs leading-5 text-white/55"><ol className="space-y-2">{visual.storyboard.scenes.map((item, index) => <li key={item.id}><strong className="text-white/80">{index + 1}. {item.title}</strong> — {item.caption}<ul className="list-disc pl-5">{item.entityIds.map((id) => <li key={id}>{researchEntityLabel(visual.semanticModel, id)}{item.highlightEntityIds.includes(id) ? " — highlighted" : ""}</li>)}</ul></li>)}</ol><div><h4 className="font-semibold text-white/80">Sources</h4><ul className="mt-1 space-y-1">{visual.sources.map((source) => <li key={source.id}><a href={source.url} target="_blank" rel="noopener noreferrer" className="text-cyan-100/70 hover:text-cyan-50">{source.title} <ExternalLink size={9} className="inline" /></a> <span className="text-white/30">· {source.quality.replaceAll("_", " ")}{source.publisher ? ` · ${source.publisher}` : ""}</span></li>)}</ul></div></div></details>

    <footer className="visual-export-ignore mt-3 flex flex-wrap items-center justify-between gap-2"><p className="flex items-center gap-1.5 text-[10px] leading-4 text-white/32"><ShieldCheck size={12} /> Validated semantic evidence rendered locally. Generated HTML/scripts are never executed.</p><div className="flex gap-1.5"><button type="button" disabled={!!exporting} onClick={() => void runExport("svg")} className="btn-deck btn-ghost disabled:opacity-35"><Download size={12} /> {exporting === "svg" ? "Exporting…" : "SVG"}</button><button type="button" disabled={!!exporting} onClick={() => void runExport("png")} className="btn-deck btn-ghost disabled:opacity-35"><FileImage size={12} /> {exporting === "png" ? "Exporting…" : "PNG"}</button></div></footer>
    {exportError && <p role="alert" className="mt-2 text-xs text-red-200">{exportError}</p>}<div className="sr-only" aria-live="polite">Scene {sceneIndex + 1} of {visual.storyboard.scenes.length}: {scene.title}. {selected.length} selected entities.</div>
  </div>;

  if (expanded && typeof document !== "undefined") return <>{<div className="rounded-2xl border border-cyan-200/15 bg-cyan-300/[0.04] p-4 text-sm text-white/55">Research visual expanded inside AVA.</div>}{createPortal(<div className="fixed inset-0 z-[100] bg-black/88 p-2 backdrop-blur-xl sm:p-5" role="dialog" aria-modal="true" aria-label={`Expanded ${visual.title}`}><div className="mx-auto flex h-full max-w-[1500px] flex-col overflow-hidden rounded-2xl border border-cyan-200/18 bg-[#060a0e] p-3 sm:p-5">{content(true)}</div></div>, document.body)}</>;
  return <section className={mode === "inline" ? "w-full rounded-2xl border border-cyan-200/12 bg-[#071014]/92 p-2.5 shadow-[0_24px_70px_-42px_rgba(30,215,230,0.45)] sm:p-3.5" : ""}>{content(false)}</section>;
}
