import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Download, FileImage, ListTree, ShieldCheck } from "lucide-react";
import { useReducedMotion } from "../lib/useReducedMotion.js";
import type { VisualExplanation } from "./api.js";
import {
  buildSandboxDocument,
  buildSceneMermaid,
  downloadPng,
  downloadSvg,
  renderMermaidSvg,
} from "./render.js";

export function VisualExplanationViewer({
  visual,
  render = renderMermaidSvg,
}: {
  visual: VisualExplanation;
  render?: (source: string, id: string, title: string, description: string) => Promise<string>;
}) {
  const reduced = useReducedMotion();
  const startIndex = Math.max(0, visual.storyboard.scenes.findIndex((scene) => scene.id === visual.storyboard.startSceneId));
  const [sceneIndex, setSceneIndex] = useState(startIndex);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const scene = visual.storyboard.scenes[sceneIndex] ?? visual.storyboard.scenes[0]!;
  const nodeById = useMemo(() => new Map(visual.topology.nodes.map((node) => [node.id, node])), [visual]);

  useEffect(() => { setSceneIndex(startIndex); }, [visual.id, startIndex]);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setError(null);
    const source = buildSceneMermaid(visual, scene);
    void render(source, `${visual.id}_${scene.id}`, `${visual.title}: ${scene.title}`, scene.caption)
      .then((next) => { if (!cancelled) setSvg(next); })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "The diagram could not be rendered."); });
    return () => { cancelled = true; };
  }, [render, scene, visual]);

  const move = (next: number) => setSceneIndex(Math.max(0, Math.min(visual.storyboard.scenes.length - 1, next)));
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowRight") { event.preventDefault(); move(sceneIndex + 1); }
    if (event.key === "ArrowLeft") { event.preventDefault(); move(sceneIndex - 1); }
    if (event.key === "Home") { event.preventDefault(); move(0); }
    if (event.key === "End") { event.preventDefault(); move(visual.storyboard.scenes.length - 1); }
  };

  const exportPng = async () => {
    if (!svg) return;
    setExportError(null);
    try { await downloadPng(svg, visual.title, scene.title); }
    catch (cause) { setExportError(cause instanceof Error ? cause.message : "PNG export failed."); }
  };

  return (
    <div ref={rootRef} tabIndex={0} onKeyDown={onKeyDown} aria-label={`${visual.title} visual walkthrough`} className="outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 rounded-2xl">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="hud text-[10px] tracking-[0.2em] text-cyan-200/60">SCENE {sceneIndex + 1} / {visual.storyboard.scenes.length}</div>
          <h2 className="mt-1 text-xl font-semibold text-white">{scene.title}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-white/65">{scene.caption}</p>
          {scene.interactionCue && <p className="mt-2 text-xs text-cyan-100/65">Cue: {scene.interactionCue}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!svg} onClick={() => svg && downloadSvg(svg, visual.title, scene.title)} className="btn-deck btn-ghost flex items-center gap-2 disabled:opacity-35"><Download size={13} /> SVG</button>
          <button type="button" disabled={!svg} onClick={() => void exportPng()} className="btn-deck btn-ghost flex items-center gap-2 disabled:opacity-35"><FileImage size={13} /> PNG</button>
        </div>
      </div>

      <div className="relative min-h-[360px] overflow-hidden rounded-2xl border border-cyan-200/15 bg-[#05080b]">
        <AnimatePresence mode="wait">
          <motion.div
            key={`${visual.id}-${scene.id}`}
            initial={reduced || scene.transition === "none" ? { opacity: 1 } : scene.transition === "slide" ? { opacity: 0, x: 24 } : { opacity: 0 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduced || scene.transition === "none" ? { opacity: 1 } : { opacity: 0, x: scene.transition === "slide" ? -16 : 0 }}
            transition={{ duration: reduced ? 0 : 0.28 }}
            className="absolute inset-0"
          >
            {svg ? (
              <iframe
                title={`${visual.title}: ${scene.title}`}
                sandbox=""
                referrerPolicy="no-referrer"
                srcDoc={buildSandboxDocument(svg)}
                className="h-full w-full border-0"
              />
            ) : error ? (
              <div className="flex h-full min-h-[360px] items-center justify-center px-8 text-center text-sm text-amber-100/75">{error} Use the accessible text view below.</div>
            ) : (
              <div className="flex h-full min-h-[360px] items-center justify-center text-sm text-white/40">Rendering locally…</div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <button type="button" aria-label="Previous scene" disabled={sceneIndex === 0} onClick={() => move(sceneIndex - 1)} className="btn-deck btn-ghost flex items-center gap-2 disabled:opacity-30"><ArrowLeft size={13} /> Previous</button>
        <div className="flex max-w-[60%] flex-wrap justify-center gap-1.5" role="tablist" aria-label="Storyboard scenes">
          {visual.storyboard.scenes.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={index === sceneIndex}
              aria-label={`Scene ${index + 1}: ${item.title}`}
              onClick={() => move(index)}
              className={`h-2 rounded-full transition-all ${index === sceneIndex ? "w-7 bg-cyan-300" : "w-2 bg-white/20 hover:bg-white/40"}`}
            />
          ))}
        </div>
        <button type="button" aria-label="Next scene" disabled={sceneIndex === visual.storyboard.scenes.length - 1} onClick={() => move(sceneIndex + 1)} className="btn-deck btn-primary flex items-center gap-2 disabled:opacity-30">Next <ArrowRight size={13} /></button>
      </div>
      <div className="sr-only" aria-live="polite">Scene {sceneIndex + 1} of {visual.storyboard.scenes.length}: {scene.title}</div>
      {exportError && <p role="alert" className="mt-3 text-xs text-red-200">{exportError}</p>}

      <details className="mt-5 rounded-xl border border-white/10 bg-white/[0.025] px-4 py-3">
        <summary className="cursor-pointer list-none text-xs font-medium text-white/70"><span className="flex items-center gap-2"><ListTree size={14} /> Accessible text version</span></summary>
        <div className="mt-4 space-y-4 text-sm leading-6 text-white/65">
          <p>{visual.summary}</p>
          <ol className="space-y-4">
            {visual.storyboard.scenes.map((item, index) => (
              <li key={item.id}>
                <strong className="text-white/85">{index + 1}. {item.title}</strong>
                <p>{item.caption}</p>
                <ul className="mt-1 list-disc pl-5">
                  {item.nodeIds.map((id) => <li key={id}>{nodeById.get(id)?.label ?? id}{item.highlightNodeIds.includes(id) ? " — highlighted" : ""}</li>)}
                </ul>
              </li>
            ))}
          </ol>
        </div>
      </details>
      <p className="mt-3 flex items-center gap-2 text-[10px] leading-4 text-white/35"><ShieldCheck size={12} /> Sandboxed static SVG. No scripts, network requests, external media, forms or persisted render artifacts.</p>
    </div>
  );
}

