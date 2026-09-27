import { useEffect, useRef } from "react";
import { useReducedMotion } from "../motion.js";
import { useDocumentLook } from "../face/useDocumentLook.js";

export type AtmosphereKind = "nocturne" | "silk";

/** Original Canvas2D line fields. Decorative only, no WebGL/provider/data reads.
 * A token-based static gradient remains if canvas is unavailable. */
export function Atmosphere({ kind }: { kind: AtmosphereKind }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();
  const look = useDocumentLook();
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || typeof CanvasRenderingContext2D === "undefined") return;
    let context: CanvasRenderingContext2D | null;
    try { context = canvas.getContext("2d"); } catch { return; }
    if (!context) return;
    const ctx = context;
    let width = 1, height = 1, phase = 0, last = 0, frame = 0, visible = true, disposed = false;
    const forced = window.matchMedia("(forced-colors: active)");
    const paint = () => {
      ctx.clearRect(0, 0, width, height);
      if (forced.matches) return;
      const count = width < 600 ? 36 : 64;
      ctx.lineWidth = 0.7;
      for (let i = 0; i < count; i++) {
        ctx.globalAlpha = 0.06 + 0.15 * Math.sin((i / count) * Math.PI);
        ctx.beginPath();
        for (let j = 0; j <= 48; j++) {
          const x = (j / 48) * width;
          const y = kind === "silk"
            ? height * (0.22 + i / count * 0.54) + Math.sin(j / 13 + i / 19 + phase) * height * 0.18
            : height * (0.45 + i / count * 0.46) - Math.sin(j / 32 + i / 25 + phase * 0.35) * height * 0.24;
          if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };
    const tick = (now: number) => {
      frame = 0;
      if (disposed || reduced || document.hidden || !visible || forced.matches) return;
      if (!last || now - last >= 40) {
        phase += last ? Math.min(now - last, 100) * 0.00006 : 0;
        last = now;
        paint();
      }
      frame = requestAnimationFrame(tick);
    };
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      last = 0;
      if (!disposed && !document.hidden && visible) {
        paint();
        if (!reduced && !forced.matches) frame = requestAnimationFrame(tick);
      }
    };
    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = Math.max(1, Math.min(2560, bounds.width));
      height = Math.max(1, Math.min(1600, bounds.height));
      const ratio = Math.min(1.5, Math.max(1, window.devicePixelRatio || 1));
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--ds-atmosphere-line").trim() || "currentColor";
      sync();
    };
    const size = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    const intersection = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      sync();
    });
    size?.observe(canvas); intersection?.observe(canvas);
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", sync);
    forced.addEventListener("change", sync);
    resize();
    return () => {
      disposed = true; cancelAnimationFrame(frame);
      size?.disconnect(); intersection?.disconnect();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", sync);
      forced.removeEventListener("change", sync);
    };
  }, [kind, reduced, look]);
  return <div className="ds-atmosphere" data-atmosphere={kind} aria-hidden="true">
    <canvas ref={ref} data-motion={reduced ? "static" : "animated"} />
  </div>;
}
