import { useEffect, useRef, useState } from "react";
import { computeReduced } from "../../lib/motionPref.js";
import { useReducedMotion } from "../motion.js";
import { cn } from "../cn.js";
import { FaceAnimator, type FaceMode } from "./animator.js";
import { sharedFaceAsset, type FaceAsset } from "./asset.js";
import { FaceStill } from "./FaceStill.js";
import { buildPoints } from "./model.js";
import { FaceRenderer } from "./renderer.js";
import { useDocumentLook } from "./useDocumentLook.js";

/** Only one animated face exists at a time (one WebGL context, contract ui-remodel v2 §5). */
let liveStages = 0;
export function claimFaceSlot(): (() => void) | null {
  if (liveStages > 0) return null;
  liveStages += 1;
  let released = false;
  return () => { if (!released) { released = true; liveStages -= 1; } };
}

function isSmallScreen(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 600px)").matches;
}

export type FaceStageProps = {
  mode?: FaceMode;
  /** Live voice energy 0..1 while speaking (voice/faceSignal); omit to simulate. */
  level?: number | null;
  label?: string;
  className?: string;
};

/**
 * AVA's moving face: the dots of Niko's portrait on the one WebGL canvas, glowing
 * in Ink and engraved in Paper. It blinks, glances, follows the pointer and takes
 * a pose for each state. It pauses off-screen and in hidden tabs, holds still
 * under reduced motion, and falls back to a still picture if anything fails.
 */
export function FaceStage({ mode = "idle", level = null, label = "AVA's face", className }: FaceStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const look = useDocumentLook();
  const reduced = useReducedMotion();
  const [asset, setAsset] = useState<FaceAsset | null>(null);
  const [fallback, setFallback] = useState(false);
  const [slotted, setSlotted] = useState(false);
  const animator = useRef(new FaceAnimator());
  const frame = useRef<{ redraw: () => void } | null>(null);

  animator.current.mode = mode;
  animator.current.level = level;

  // Claim the single face slot for this mount; a second stage shows the still picture.
  useEffect(() => {
    const release = claimFaceSlot();
    if (!release) { setFallback(true); return; }
    setSlotted(true);
    return release;
  }, []);

  useEffect(() => {
    if (!slotted) return;
    let alive = true;
    sharedFaceAsset().then((loaded) => { if (alive) setAsset(loaded); }, (error: unknown) => {
      if (!alive) return;
      console.warn("[ava] face asset unavailable, showing the still face:", error instanceof Error ? error.message : error);
      setFallback(true);
    });
    return () => { alive = false; };
  }, [slotted]);

  // Create the renderer once per canvas, upload the look's dots, and run the loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!asset || !canvas || fallback) return;
    let r: FaceRenderer;
    try {
      // One renderer per effect run; the canvas keeps its single WebGL context throughout.
      r = new FaceRenderer(canvas);
      const small = isSmallScreen();
      const points = look === "paper"
        ? buildPoints(asset, "stipple", small ? 42_000 : asset.stipple.count)
        : buildPoints(asset, "glow", small ? 20_000 : asset.glow.count);
      r.setPoints(points, look);
      r.resize();
    } catch (error) {
      console.warn("[ava] face renderer unavailable, showing the still face:", error instanceof Error ? error.message : error);
      setFallback(true);
      return;
    }
    const active = r;
    const anim = animator.current;
    let visible = true;
    let raf = 0;
    let last = performance.now();
    const drawOnce = () => { anim.step(0, 0); active.draw(0, anim); };
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (visible && !document.hidden) { anim.step(now / 1000, dt); active.draw(now / 1000, anim); }
      raf = requestAnimationFrame(tick);
    };
    const still = reduced || computeReduced();
    if (still) drawOnce(); else raf = requestAnimationFrame(tick);
    frame.current = { redraw: () => { if (still) drawOnce(); } };

    const resize = new ResizeObserver(() => { active.resize(); if (still) drawOnce(); });
    resize.observe(canvas);
    const seen = new IntersectionObserver(([entry]) => { visible = entry?.isIntersecting ?? true; });
    seen.observe(canvas);
    // Reduced motion is one static frame: the face does not follow the pointer at all.
    const onMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      anim.pointer = [((event.clientX - rect.left) / rect.width) * 2 - 1, -(((event.clientY - rect.top) / rect.height) * 2 - 1)];
    };
    const onLeave = () => { anim.pointer = null; };
    const onLost = (event: Event) => { event.preventDefault(); setFallback(true); };
    if (!still) {
      canvas.addEventListener("pointermove", onMove);
      canvas.addEventListener("pointerleave", onLeave);
    }
    canvas.addEventListener("webglcontextlost", onLost);
    return () => {
      cancelAnimationFrame(raf);
      resize.disconnect();
      seen.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("webglcontextlost", onLost);
      frame.current = null;
      active.dispose();
    };
  }, [asset, look, reduced, fallback]);

  // A still face still reacts to a new state.
  useEffect(() => { frame.current?.redraw(); }, [mode, level]);

  if (fallback) {
    return (
      <div className={cn("grid place-items-center", className)} data-face="still">
        <FaceStill size={220} label={label} className="rounded-none" />
      </div>
    );
  }
  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      data-face="live"
      className={cn("block h-full w-full touch-pan-y", className)}
    />
  );
}
