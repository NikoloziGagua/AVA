import { useEffect, useRef } from "react";
import { useReducedMotion } from "../motion.js";
import { useDocumentLook } from "../face/useDocumentLook.js";
import { advanceStars, createStars, projectStar } from "./particles.js";

/**
 * Decorative Canvas2D only. Does not take the face's WebGL slot or read audio.
 * Lazy Home/Voice layer. Static under reduced motion; no paint in forced colours.
 */
export function Starfield() {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();
  const look = useDocumentLook();

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || typeof CanvasRenderingContext2D === "undefined") return;
    let ctx: CanvasRenderingContext2D | null;
    try { ctx = canvas.getContext("2d", { alpha: true }); } catch { return; }
    if (!ctx) return;
    const context = ctx;
    let stars = createStars(900);
    let width = 1, height = 1, raf = 0, visible = true, last = 0, disposed = false;
    const forced = window.matchMedia("(forced-colors: active)");

    const draw = () => {
      context.clearRect(0, 0, width, height);
      if (forced.matches) return;
      for (const star of stars) {
        const point = projectStar(star, width, height);
        if (!point.visible) continue;
        context.globalAlpha = point.opacity;
        context.beginPath();
        context.arc(point.x, point.y, point.radius, 0, Math.PI * 2);
        context.fill();
      }
      context.globalAlpha = 1;
    };
    const tick = (now: number) => {
      raf = 0;
      if (disposed || reduced || document.hidden || !visible || forced.matches) return;
      if (!last || now - last >= 1000 / 60) {
        advanceStars(stars, last ? (now - last) / 1000 : 0);
        last = now;
        draw();
      }
      raf = requestAnimationFrame(tick);
    };
    const sync = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
      if (!disposed && !document.hidden && visible) {
        draw();
        if (!reduced && !forced.matches) raf = requestAnimationFrame(tick);
      }
    };
    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = Math.max(1, Math.min(2560, bounds.width));
      height = Math.max(1, Math.min(1600, bounds.height));
      const count = width < 600 ? 500 : 900;
      if (stars.length !== count) stars = createStars(count);
      canvas.dataset.starCount = String(count);
      const ratio = Math.min(1.5, Math.max(1, window.devicePixelRatio || 1));
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--ds-face-dot").trim() || "currentColor";
      sync();
    };
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    const intersection = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      sync();
    }) : null;
    observer?.observe(canvas);
    intersection?.observe(canvas);
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", sync);
    forced.addEventListener("change", sync);
    resize();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer?.disconnect();
      intersection?.disconnect();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", sync);
      forced.removeEventListener("change", sync);
    };
  }, [reduced, look]);

  return <canvas ref={ref} aria-hidden="true" data-metal-stars={reduced ? "static" : "animated"}
    className="pointer-events-none absolute inset-0 h-full w-full" />;
}
