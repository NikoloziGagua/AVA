import { useEffect, useRef } from "react";
import { useReducedMotion } from "../../lib/useReducedMotion.js";

export interface SpaceBackgroundProps {
  particleCount?: number;
  /** Inner radius (in CSS px before DPR scale) where particles converge. */
  coreRadius?: number;
  /** Hue tint applied to particles (0..360). Default leaves them neutral white. */
  tintHue?: number;
  className?: string;
}

interface Particle {
  x: number;
  y: number;
  radius: number;
  ring: number;
  move: number;
  random: number;
}

export function SpaceBackground({
  particleCount = 380,
  coreRadius = 130,
  tintHue,
  className,
}: SpaceBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;
    const ctxEl = canvasEl.getContext("2d");
    if (!ctxEl) return;
    const canvas = canvasEl;
    const ctx = ctxEl;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let raf = 0;
    let counter = 0;

    function setupCanvas() {
      const parent = canvas.parentElement;
      if (!parent) return;
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, -dpr, canvas.width / 2, canvas.height / 2);
    }
    setupCanvas();

    const particles: Particle[] = [];
    const fillStyle = tintHue == null
      ? "rgba(255,255,255,0.85)"
      : `hsla(${tintHue}, 80%, 75%, 0.85)`;

    function spawn() {
      particles.push({
        x: Math.cos(Math.random() * 7 + Math.PI) * coreRadius,
        y: Math.sin(Math.random() * 7 + Math.PI) * coreRadius,
        radius: Math.random() * 4.5 + 0.3,
        ring: Math.random() * coreRadius * 3,
        move: (Math.random() * 4 + 1) / 500,
        random: Math.random() * 7,
      });
    }
    for (let i = 0; i < particleCount; i++) spawn();

    function step(p: Particle) {
      p.ring = Math.max(p.ring - 1, coreRadius);
      p.random += p.move;
      p.x = Math.cos(p.random + Math.PI) * p.ring;
      p.y = Math.sin(p.random + Math.PI) * p.ring;
      if (p.radius < 0.6) {
        p.ring = Math.random() * coreRadius * 3;
        p.radius = Math.random() * 4.5 + 0.3;
      } else {
        p.radius *= 0.994;
      }
    }

    function draw(p: Particle) {
      ctx.beginPath();
      ctx.fillStyle = fillStyle;
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    function loop() {
      ctx.clearRect(-canvas.width, -canvas.height, canvas.width * 2, canvas.height * 2);
      if (counter < particles.length) counter++;
      for (let i = 0; i < counter; i++) {
        step(particles[i]!);
        draw(particles[i]!);
      }
      raf = requestAnimationFrame(loop);
    }

    if (reduced) {
      // static frame: draw everything once at their initial positions
      for (let i = 0; i < particles.length; i++) draw(particles[i]!);
    } else {
      raf = requestAnimationFrame(loop);
    }

    function handleResize() { setupCanvas(); }
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [particleCount, coreRadius, tintHue, reduced]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        display: "block",
      }}
      aria-hidden="true"
    />
  );
}
