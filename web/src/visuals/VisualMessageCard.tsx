import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Download,
  Expand,
  FileImage,
  Focus,
  Maximize2,
  MessageCircleQuestion,
  Minus,
  Paperclip,
  Plus,
  RotateCcw,
  ShieldCheck,
  X,
} from "lucide-react";
import { useReducedMotion } from "../lib/useReducedMotion.js";
import type { VisualMessage, VisualMessageContext, VisualScene } from "./types.js";
import {
  buildSceneMermaid,
  downloadPng,
  downloadSvg,
  renderMermaidSvg,
  sanitizeRenderedSvg,
} from "./render.js";

export type VisualSemanticActionHandler = (
  context: VisualMessageContext,
  visual: VisualMessage,
) => void;

type Props = {
  visual: VisualMessage;
  mode?: "inline" | "workspace";
  onSemanticAction?: VisualSemanticActionHandler;
  render?: (source: string, id: string, title: string, description: string) => Promise<string>;
};

function sceneIndexFor(visual: VisualMessage): number {
  return Math.max(0, visual.storyboard.scenes.findIndex((scene) => scene.id === visual.storyboard.startSceneId));
}

export function VisualMessageCard({
  visual,
  mode = "inline",
  onSemanticAction,
  render = renderMermaidSvg,
}: Props) {
  const reduced = useReducedMotion();
  const instanceId = useId().replace(/[^A-Za-z0-9_-]/g, "_");
  const startIndex = sceneIndexFor(visual);
  const [sceneIndex, setSceneIndex] = useState(startIndex);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; panX: number; panY: number } | null>(null);
  const returnRef = useRef<{ scroller: HTMLElement | null; scrollTop: number } | null>(null);
  const scene = visual.storyboard.scenes[sceneIndex] ?? visual.storyboard.scenes[0]!;
  const elementById = useMemo(
    () => new Map(visual.semanticModel.elements.map((element) => [element.id, element])),
    [visual.semanticModel.elements],
  );
  const sceneElements = scene.nodeIds.map((id) => elementById.get(id)).filter((element) => element !== undefined);

  useEffect(() => {
    setSceneIndex(sceneIndexFor(visual));
    setSelectedIds([]);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [visual.visualMessageId, visual.revision]);

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => scene.nodeIds.includes(id)));
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [scene.id]);

  useEffect(() => {
    let cancelled = false;
    const scroller = rootRef.current?.closest(".soft-scrollbar") as HTMLElement | null;
    const shouldAnchor = !!scroller && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 180;
    setSvg(null);
    setError(null);
    const source = buildSceneMermaid(visual, scene);
    const renderId = `${visual.visualMessageId}_${visual.revision}_${scene.id}_${instanceId}`;
    void render(source, renderId, `${visual.title}: ${scene.title}`, scene.caption)
      .then((raw) => {
        if (cancelled) return;
        // Always re-sanitize at the native injection boundary, including test,
        // cache, and future renderer adapters.
        setSvg(sanitizeRenderedSvg(raw, `${visual.title}: ${scene.title}`, scene.caption, renderId));
        if (shouldAnchor) requestAnimationFrame(() => rootRef.current?.scrollIntoView({ block: "end" }));
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "The diagram could not be rendered.");
      });
    return () => { cancelled = true; };
  }, [instanceId, render, scene, visual]);

  useEffect(() => {
    if (!expanded) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeExpanded();
    };
    document.addEventListener("keydown", onEscape);
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => rootRef.current?.focus());
    return () => {
      document.removeEventListener("keydown", onEscape);
      document.body.style.overflow = priorOverflow;
    };
    // closeExpanded is intentionally state-local; attaching once per expansion
    // avoids churn while preserving the exact card instance and its state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  const move = (next: number) => setSceneIndex(Math.max(0, Math.min(visual.storyboard.scenes.length - 1, next)));
  const changeZoom = (next: number) => setZoom(Math.max(0.75, Math.min(2.5, Math.round(next * 100) / 100)));
  const resetViewport = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowRight") { event.preventDefault(); move(sceneIndex + 1); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); move(sceneIndex - 1); }
    else if (event.key === "Home") { event.preventDefault(); move(0); }
    else if (event.key === "End") { event.preventDefault(); move(visual.storyboard.scenes.length - 1); }
    else if (event.key === "+" || event.key === "=") { event.preventDefault(); changeZoom(zoom + 0.15); }
    else if (event.key === "-") { event.preventDefault(); changeZoom(zoom - 0.15); }
    else if (event.key === "0") { event.preventDefault(); resetViewport(); }
  };

  const toggleSelection = (id: string) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const makeContext = (action: VisualMessageContext["action"]): VisualMessageContext | null => {
    if (!visual.storyboard.scenes.some((item) => item.id === scene.id)) return null;
    const safeSelection = selectedIds.filter((id) => scene.nodeIds.includes(id) && elementById.has(id));
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

  const exportPng = async () => {
    if (!svg) return;
    setExportError(null);
    try { await downloadPng(svg, visual.title, scene.title); }
    catch (cause) { setExportError(cause instanceof Error ? cause.message : "PNG export failed."); }
  };

  const beginPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (zoom <= 1) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
  };
  const movePan = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPan({ x: drag.panX + event.clientX - drag.x, y: drag.panY + event.clientY - drag.y });
  };
  const endPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  const card = (overlay: boolean) => (
    <div
      ref={rootRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label={`${visual.title} visual explanation, revision ${visual.revision}`}
      data-testid="visual-message-card"
      data-visual-id={visual.visualMessageId}
      data-revision={visual.revision}
      className={`outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 ${overlay ? "flex h-full flex-col" : ""}`}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="hud text-[9px] tracking-[0.2em] text-cyan-200/55">VISUAL · REV {visual.revision} · SCENE {sceneIndex + 1}/{visual.storyboard.scenes.length}</div>
          <h3 className="mt-1 text-base font-semibold text-white sm:text-lg">{visual.title}</h3>
          <p className="mt-1 text-[13px] leading-5 text-white/60">{scene.caption}</p>
          {scene.interactionCue && <p className="mt-1 text-[11px] text-cyan-100/60">{scene.interactionCue}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Visual controls">
          <button type="button" aria-label="Zoom out" onClick={() => changeZoom(zoom - 0.15)} className="btn-deck btn-ghost p-2"><Minus size={13} /></button>
          <span className="min-w-10 text-center text-[10px] text-white/45" aria-live="polite">{Math.round(zoom * 100)}%</span>
          <button type="button" aria-label="Zoom in" onClick={() => changeZoom(zoom + 0.15)} className="btn-deck btn-ghost p-2"><Plus size={13} /></button>
          <button type="button" aria-label="Reset zoom and pan" onClick={resetViewport} className="btn-deck btn-ghost p-2"><RotateCcw size={13} /></button>
          {!overlay && mode === "inline" && <button type="button" aria-label="Expand visual inside AVA" onClick={openExpanded} className="btn-deck btn-ghost p-2"><Maximize2 size={13} /></button>}
          {overlay && <button type="button" aria-label="Close expanded visual" onClick={closeExpanded} className="btn-deck btn-ghost p-2"><X size={14} /></button>}
        </div>
      </header>

      <div
        className={`relative mt-3 overflow-hidden rounded-xl border border-cyan-200/15 bg-[#05080b] ${overlay ? "min-h-0 flex-1" : "h-[280px] sm:h-[340px]"}`}
        data-testid="visual-pan-viewport"
        onPointerDown={beginPan}
        onPointerMove={movePan}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        style={{ touchAction: zoom > 1 ? "none" : "pan-y" }}
      >
        {svg ? (
          <div className="absolute inset-0 grid place-items-center p-4 sm:p-6">
            <div
              data-testid="native-visual-svg"
              className={`h-full w-full [&_svg]:h-full [&_svg]:w-full [&_svg]:max-w-full ${reduced ? "" : "transition-transform duration-200 ease-out"}`}
              style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "center" }}
              // `svg` has passed the strict Mermaid renderer and the allow-list
              // sanitizer again immediately before this native injection.
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-amber-100/75" role="alert">
            {error} The complete text version remains available below.
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-white/40">Rendering locally…</div>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <button type="button" aria-label="Previous scene" disabled={sceneIndex === 0} onClick={() => move(sceneIndex - 1)} className="btn-deck btn-ghost flex items-center gap-1.5 disabled:opacity-30"><ArrowLeft size={13} /> <span className="hidden sm:inline">Previous</span></button>
        <div className="flex min-w-0 flex-wrap justify-center gap-1.5" role="tablist" aria-label="Visual scenes">
          {visual.storyboard.scenes.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={index === sceneIndex}
              aria-label={`Scene ${index + 1}: ${item.title}`}
              onClick={() => move(index)}
              className={`h-2 rounded-full ${reduced ? "" : "transition-all"} ${index === sceneIndex ? "w-7 bg-cyan-300" : "w-2 bg-white/20 hover:bg-white/40"}`}
            />
          ))}
        </div>
        <button type="button" aria-label="Next scene" disabled={sceneIndex === visual.storyboard.scenes.length - 1} onClick={() => move(sceneIndex + 1)} className="btn-deck btn-primary flex items-center gap-1.5 disabled:opacity-30"><span className="hidden sm:inline">Next</span> <ArrowRight size={13} /></button>
      </div>
      <div className="sr-only" aria-live="polite">Scene {sceneIndex + 1} of {visual.storyboard.scenes.length}: {scene.title}. Zoom {Math.round(zoom * 100)} percent.</div>

      <div className="mt-3 rounded-xl border border-white/8 bg-white/[0.025] p-3">
        <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.16em] text-white/45"><Focus size={12} /> Select visual context</div>
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Scene elements">
          {sceneElements.map((element) => {
            const selected = selectedIds.includes(element.id);
            return (
              <button
                key={element.id}
                type="button"
                aria-pressed={selected}
                onClick={() => toggleSelection(element.id)}
                className={`rounded-full border px-2.5 py-1 text-[11px] ${selected ? "border-cyan-300/70 bg-cyan-300/15 text-cyan-50" : "border-white/10 bg-white/[0.03] text-white/55 hover:border-white/25"}`}
              >
                {element.label}
              </button>
            );
          })}
        </div>
        {onSemanticAction && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => invoke("explain")} className="btn-deck btn-ghost flex items-center gap-1.5"><MessageCircleQuestion size={13} /> Explain this</button>
            <button type="button" disabled={!selectedIds.length} onClick={() => invoke("branch")} className="btn-deck btn-ghost flex items-center gap-1.5 disabled:opacity-35"><Expand size={13} /> Ask AVA about this branch</button>
            <button type="button" disabled={!selectedIds.length} onClick={() => invoke("attach")} className="btn-deck btn-ghost flex items-center gap-1.5 disabled:opacity-35"><Paperclip size={13} /> Attach selected context</button>
          </div>
        )}
      </div>

      <details className="mt-3 rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2.5">
        <summary className="cursor-pointer list-none text-xs font-medium text-white/65"><span className="flex items-center gap-2"><ChevronDown size={13} /> Accessible text version</span></summary>
        <div className="mt-3 space-y-3 text-sm leading-6 text-white/65">
          <p>{visual.accessibleFallback.summary}</p>
          <ol className="space-y-3">
            {visual.storyboard.scenes.map((item, index) => (
              <li key={item.id}>
                <strong className="text-white/85">{index + 1}. {item.title}</strong>
                <p>{item.caption}</p>
                <ul className="mt-1 list-disc pl-5">
                  {item.nodeIds.map((id) => <li key={id}>{elementById.get(id)?.label ?? id}{item.highlightNodeIds.includes(id) ? " — highlighted" : ""}</li>)}
                </ul>
              </li>
            ))}
          </ol>
          <h4 className="font-medium text-white/80">Relationships</h4>
          <ul className="list-disc pl-5">{visual.accessibleFallback.relationships.map((relationship) => <li key={relationship.id}>{relationship.text}</li>)}</ul>
        </div>
      </details>

      <footer className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[10px] leading-4 text-white/35"><ShieldCheck size={12} /> Native sanitized SVG · no generated scripts, HTML, network, or persisted render artifacts.</p>
        <div className="flex gap-1.5">
          <button type="button" disabled={!svg} onClick={() => svg && downloadSvg(svg, visual.title, scene.title)} className="btn-deck btn-ghost flex items-center gap-1.5 disabled:opacity-35"><Download size={12} /> SVG</button>
          <button type="button" disabled={!svg} onClick={() => void exportPng()} className="btn-deck btn-ghost flex items-center gap-1.5 disabled:opacity-35"><FileImage size={12} /> PNG</button>
        </div>
      </footer>
      {exportError && <p role="alert" className="mt-2 text-xs text-red-200">{exportError}</p>}
    </div>
  );

  if (expanded && typeof document !== "undefined") {
    return (
      <>
        <div className="rounded-2xl border border-cyan-200/15 bg-cyan-300/[0.04] p-4 text-sm text-white/55">Visual expanded inside AVA.</div>
        {createPortal(
          <div className="fixed inset-0 z-[100] bg-black/85 p-3 backdrop-blur-xl sm:p-6" role="dialog" aria-modal="true" aria-label={`Expanded ${visual.title}`}>
            <div className="mx-auto h-full max-w-7xl overflow-y-auto rounded-2xl border border-cyan-200/20 bg-[#070a0d] p-4 shadow-2xl sm:p-6">
              {card(true)}
            </div>
          </div>,
          document.body,
        )}
      </>
    );
  }

  return (
    <section className={`${mode === "inline" ? "w-full rounded-2xl border border-cyan-200/15 bg-[#071014]/90 p-3 sm:p-4" : ""}`}>
      {card(false)}
    </section>
  );
}
