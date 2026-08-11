import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  CircleCheck,
  Download,
  Expand,
  FileImage,
  Focus,
  GitBranch,
  Maximize2,
  MessageCircleQuestion,
  Paperclip,
  Route,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { useReducedMotion } from "../lib/useReducedMotion.js";
import { exportVisualCanvas } from "./render.js";
import type { VisualMessage, VisualMessageContext } from "./types.js";
import { VisualFlowCanvas } from "./VisualFlowCanvas.js";

export type VisualSemanticActionHandler = (
  context: VisualMessageContext,
  visual: VisualMessage,
) => void;

type Props = {
  visual: VisualMessage;
  mode?: "inline" | "workspace";
  onSemanticAction?: VisualSemanticActionHandler;
  canvasComponent?: typeof VisualFlowCanvas;
  exporter?: typeof exportVisualCanvas;
};

type BoundaryProps = { resetKey: string; fallback: ReactNode; children: ReactNode };
type BoundaryState = { failed: boolean };

class VisualCanvasBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false };
  static getDerivedStateFromError(): BoundaryState { return { failed: true }; }
  componentDidUpdate(previous: BoundaryProps): void {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }
  render(): ReactNode { return this.state.failed ? this.props.fallback : this.props.children; }
}

function startSceneIndex(visual: VisualMessage): number {
  return Math.max(0, visual.storyboard.scenes.findIndex((scene) => scene.id === visual.storyboard.startSceneId));
}

const KIND_ICON = { process: Route, decision: GitBranch, terminal: CircleCheck } as const;

export function VisualMessageCard({
  visual,
  mode = "inline",
  onSemanticAction,
  canvasComponent: Canvas = VisualFlowCanvas,
  exporter = exportVisualCanvas,
}: Props) {
  const reducedMotion = useReducedMotion();
  const [sceneIndex, setSceneIndex] = useState(() => startSceneIndex(visual));
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [exporting, setExporting] = useState<"svg" | "png" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const returnRef = useRef<{ scroller: HTMLElement | null; scrollTop: number } | null>(null);
  const scene = visual.storyboard.scenes[sceneIndex] ?? visual.storyboard.scenes[0]!;

  const elements = useMemo(
    () => new Map(visual.semanticModel.elements.map((element) => [element.id, element])),
    [visual.semanticModel.elements],
  );
  const selectedElements = selectedIds.map((id) => elements.get(id)).filter((value) => value !== undefined);
  const selectedRelationships = visual.semanticModel.relationships.filter(
    (relationship) => selectedIds.includes(relationship.from) || selectedIds.includes(relationship.to),
  );

  useEffect(() => {
    setSceneIndex(startSceneIndex(visual));
    setSelectedIds([]);
  }, [visual.visualMessageId, visual.revision]);

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => scene.nodeIds.includes(id)));
  }, [scene.id, scene.nodeIds]);

  useEffect(() => {
    if (!expanded) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeExpanded();
    };
    document.addEventListener("keydown", onEscape);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => rootRef.current?.focus());
    return () => {
      document.removeEventListener("keydown", onEscape);
      document.body.style.overflow = previousOverflow;
    };
    // closeExpanded deliberately reads state-local refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  const move = (next: number) => setSceneIndex(Math.max(0, Math.min(visual.storyboard.scenes.length - 1, next)));

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // React Flow owns keys while focus is inside the graph. Scene navigation is
    // active only on the card itself, so node keyboard operation is undisturbed.
    if (event.target !== event.currentTarget) return;
    if (event.key === "ArrowRight") { event.preventDefault(); move(sceneIndex + 1); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); move(sceneIndex - 1); }
    else if (event.key === "Home") { event.preventDefault(); move(0); }
    else if (event.key === "End") { event.preventDefault(); move(visual.storyboard.scenes.length - 1); }
    else if (event.key === "Escape") setSelectedIds([]);
  };

  const makeContext = (action: VisualMessageContext["action"]): VisualMessageContext | null => {
    if (!visual.storyboard.scenes.some((item) => item.id === scene.id)) return null;
    const safeSelection = selectedIds.filter((id) => scene.nodeIds.includes(id) && elements.has(id));
    if ((action === "branch" || action === "attach") && safeSelection.length === 0) return null;
    return {
      visualMessageId: visual.visualMessageId,
      revision: visual.revision,
      action,
      sceneId: scene.id,
      selectedElementIds: safeSelection,
    };
  };

  const invoke = (action: VisualMessageContext["action"]) => {
    const context = makeContext(action);
    if (context) onSemanticAction?.(context, visual);
  };

  const openExpanded = () => {
    const scroller = rootRef.current?.closest(".soft-scrollbar") as HTMLElement | null;
    returnRef.current = { scroller, scrollTop: scroller?.scrollTop ?? 0 };
    setExpanded(true);
  };

  const closeExpanded = () => {
    setExpanded(false);
    requestAnimationFrame(() => {
      const saved = returnRef.current;
      if (saved?.scroller) saved.scroller.scrollTop = saved.scrollTop;
      rootRef.current?.focus();
    });
  };

  const runExport = async (format: "svg" | "png") => {
    if (!canvasRef.current || exporting) return;
    setExporting(format);
    setExportError(null);
    try { await exporter(canvasRef.current, format, visual.title, scene.title); }
    catch (cause) { setExportError(cause instanceof Error ? cause.message : `${format.toUpperCase()} export failed.`); }
    finally { setExporting(null); }
  };

  const fallback = (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center" role="alert">
      <ShieldCheck size={24} className="text-amber-200/75" />
      <p className="text-sm font-medium text-amber-50/85">The interactive graph could not be displayed.</p>
      <p className="max-w-md text-xs leading-5 text-white/50">Nothing unsafe was rendered. The complete structured text remains available below.</p>
    </div>
  );

  const card = (overlay: boolean) => (
    <div
      ref={rootRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label={`${visual.title} visual explanation, revision ${visual.revision}`}
      data-testid="visual-message-card"
      data-visual-id={visual.visualMessageId}
      data-revision={visual.revision}
      className={`outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 ${overlay ? "flex h-full min-h-0 flex-col" : ""}`}
    >
      <header className="relative overflow-hidden rounded-xl border border-cyan-200/10 bg-gradient-to-br from-cyan-300/[0.08] via-white/[0.025] to-transparent p-3 sm:p-4">
        <div className="pointer-events-none absolute -right-10 -top-16 h-40 w-40 rounded-full bg-cyan-300/10 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="chip chip-ac"><Sparkles size={10} /> Interactive map</span>
              <span className="hud text-[9px] text-white/35">Revision {visual.revision}</span>
              <span className="hud text-[9px] text-white/35">{scene.nodeIds.length} steps</span>
            </div>
            <h3 className="mt-2 text-lg font-semibold tracking-[-0.015em] text-white sm:text-xl">{visual.title}</h3>
            <p className="mt-1 max-w-3xl text-[13px] leading-5 text-white/58">{visual.summary}</p>
          </div>
          <div className="flex items-center gap-1.5 visual-export-ignore" aria-label="Visual controls">
            {!overlay && mode === "inline" && (
              <button type="button" aria-label="Expand visual inside AVA" onClick={openExpanded} className="btn-deck btn-ghost p-2"><Maximize2 size={14} /></button>
            )}
            {overlay && (
              <button type="button" aria-label="Close expanded visual" onClick={closeExpanded} className="btn-deck btn-ghost p-2"><X size={15} /></button>
            )}
          </div>
        </div>
      </header>

      <div className="visual-export-ignore mt-3 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Visual scenes">
        {visual.storyboard.scenes.map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={index === sceneIndex}
            aria-controls={`visual-scene-${visual.visualMessageId}`}
            onClick={() => move(index)}
            className={`group flex min-w-max items-center gap-2 rounded-lg border px-3 py-2 text-left ${reducedMotion ? "" : "transition-colors"} ${index === sceneIndex ? "border-cyan-300/45 bg-cyan-300/10 text-cyan-50" : "border-white/8 bg-white/[0.02] text-white/42 hover:border-white/20 hover:text-white/70"}`}
          >
            <span className={`grid h-5 w-5 place-items-center rounded-md font-mono text-[9px] ${index === sceneIndex ? "bg-cyan-300/18 text-cyan-100" : "bg-white/[0.04]"}`}>{index + 1}</span>
            <span className="text-[11px] font-medium">{item.title}</span>
          </button>
        ))}
      </div>

      <section id={`visual-scene-${visual.visualMessageId}`} className={`mt-2 ${overlay ? "flex min-h-0 flex-1 flex-col" : ""}`} aria-label={`Scene ${sceneIndex + 1}: ${scene.title}`}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
          <div>
            <p className="text-sm font-medium text-white/82">{scene.caption}</p>
            {scene.interactionCue && <p className="mt-0.5 text-[11px] text-cyan-100/48">{scene.interactionCue}</p>}
          </div>
          <p className="hud text-[8px] text-white/30">Select a step to inspect it</p>
        </div>
        <div className={`relative overflow-hidden rounded-xl border border-cyan-200/12 bg-[#050b10] ${overlay ? "min-h-[360px] flex-1" : "h-[360px] sm:h-[420px]"}`}>
          <VisualCanvasBoundary resetKey={`${visual.visualMessageId}:${visual.revision}:${scene.id}`} fallback={fallback}>
            <Canvas
              ref={canvasRef}
              visual={visual}
              scene={scene}
              selectedIds={selectedIds}
              onSelectedIdsChange={setSelectedIds}
              reducedMotion={reducedMotion}
              expanded={overlay}
            />
          </VisualCanvasBoundary>
        </div>
      </section>

      <div className="visual-export-ignore mt-3 grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="rounded-xl border border-white/8 bg-white/[0.025] px-3 py-2.5" aria-live="polite">
          {selectedElements.length ? (
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Focus size={13} className="text-cyan-200/70" />
                <span className="hud text-[9px] text-white/42">Selected context</span>
                {selectedElements.map((element) => {
                  const Icon = KIND_ICON[element.kind];
                  return <span key={element.id} className="inline-flex items-center gap-1 rounded-full border border-cyan-300/25 bg-cyan-300/[0.07] px-2 py-1 text-[11px] text-cyan-50"><Icon size={11} /> {element.label}</span>;
                })}
                <button type="button" onClick={() => setSelectedIds([])} className="ml-auto text-[10px] text-white/35 hover:text-white/70">Clear</button>
              </div>
              {selectedRelationships.length > 0 && (
                <p className="mt-2 text-[11px] leading-4 text-white/42">{selectedRelationships.length} connected relationship{selectedRelationships.length === 1 ? "" : "s"} highlighted on the map.</p>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[11px] text-white/40"><Focus size={13} /> Click or keyboard-select a step to highlight its connections and ask AVA about it.</div>
          )}
        </div>
        {onSemanticAction && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={() => invoke("explain")} className="btn-deck btn-ghost"><MessageCircleQuestion size={13} /> Explain scene</button>
            <button type="button" disabled={!selectedIds.length} onClick={() => invoke("branch")} className="btn-deck btn-primary disabled:opacity-35"><Expand size={13} /> Ask about branch</button>
            <button type="button" disabled={!selectedIds.length} onClick={() => invoke("attach")} className="btn-deck btn-ghost disabled:opacity-35"><Paperclip size={13} /> Attach</button>
          </div>
        )}
      </div>

      <div className="visual-export-ignore mt-3 flex items-center justify-between gap-2">
        <button type="button" aria-label="Previous scene" disabled={sceneIndex === 0} onClick={() => move(sceneIndex - 1)} className="btn-deck btn-ghost disabled:opacity-30"><ArrowLeft size={13} /> Previous</button>
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-cyan-200/12 to-transparent" />
        <span className="hud text-[9px] text-white/32" aria-live="polite">Scene {sceneIndex + 1} of {visual.storyboard.scenes.length}</span>
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-cyan-200/12 to-transparent" />
        <button type="button" aria-label="Next scene" disabled={sceneIndex === visual.storyboard.scenes.length - 1} onClick={() => move(sceneIndex + 1)} className="btn-deck btn-ghost disabled:opacity-30">Next <ArrowRight size={13} /></button>
      </div>

      <details className="visual-export-ignore mt-3 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
        <summary className="cursor-pointer list-none text-xs font-medium text-white/58"><span className="flex items-center gap-2"><ChevronDown size={13} /> Accessible text version</span></summary>
        <div className="mt-3 space-y-3 text-sm leading-6 text-white/62">
          <p>{visual.accessibleFallback.summary}</p>
          <ol className="space-y-3">
            {visual.storyboard.scenes.map((item, index) => (
              <li key={item.id}>
                <strong className="text-white/82">{index + 1}. {item.title}</strong>
                <p>{item.caption}</p>
                <ul className="mt-1 list-disc pl-5">
                  {item.nodeIds.map((id) => <li key={id}>{elements.get(id)?.label ?? id}{item.highlightNodeIds.includes(id) ? " - highlighted" : ""}</li>)}
                </ul>
              </li>
            ))}
          </ol>
          <h4 className="font-medium text-white/78">Relationships</h4>
          <ul className="list-disc pl-5">{visual.accessibleFallback.relationships.map((relationship) => <li key={relationship.id}>{relationship.text}</li>)}</ul>
        </div>
      </details>

      <footer className="visual-export-ignore mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[10px] leading-4 text-white/32"><ShieldCheck size={12} /> Validated semantic data rendered locally with React Flow and Dagre. No generated HTML or scripts.</p>
        <div className="flex gap-1.5">
          <button type="button" disabled={!!exporting} onClick={() => void runExport("svg")} className="btn-deck btn-ghost disabled:opacity-35"><Download size={12} /> {exporting === "svg" ? "Exporting..." : "SVG"}</button>
          <button type="button" disabled={!!exporting} onClick={() => void runExport("png")} className="btn-deck btn-ghost disabled:opacity-35"><FileImage size={12} /> {exporting === "png" ? "Exporting..." : "PNG"}</button>
        </div>
      </footer>
      {exportError && <p role="alert" className="mt-2 text-xs text-red-200">{exportError}</p>}
      <div className="sr-only" aria-live="polite">Scene {sceneIndex + 1} of {visual.storyboard.scenes.length}: {scene.title}. {selectedIds.length} selected steps.</div>
    </div>
  );

  if (expanded && typeof document !== "undefined") {
    return (
      <>
        <div className="rounded-2xl border border-cyan-200/15 bg-cyan-300/[0.04] p-4 text-sm text-white/55">Visual expanded inside AVA.</div>
        {createPortal(
          <div className="fixed inset-0 z-[100] bg-black/88 p-2 backdrop-blur-xl sm:p-5" role="dialog" aria-modal="true" aria-label={`Expanded ${visual.title}`}>
            <div className="mx-auto flex h-full max-w-[1500px] flex-col overflow-hidden rounded-2xl border border-cyan-200/18 bg-[#060a0e] p-3 shadow-2xl sm:p-5">
              {card(true)}
            </div>
          </div>,
          document.body,
        )}
      </>
    );
  }

  return (
    <section className={mode === "inline" ? "w-full rounded-2xl border border-cyan-200/12 bg-[#071014]/92 p-2.5 shadow-[0_24px_70px_-42px_rgba(30,215,230,0.45)] sm:p-3.5" : ""}>
      {card(false)}
    </section>
  );
}
