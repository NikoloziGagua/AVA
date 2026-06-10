import { useEffect, useId, useRef } from "react";
import { gsap, useGSAP } from "../../lib/gsap.js";
import { useReducedMotion } from "../../lib/useReducedMotion.js";
import type { OrbState } from "./orb-state.js";

export interface MagicRingsProps {
  /** Orb diameter in px — the rings are centered on it and extend beyond (~1.9×). */
  size: number;
  state: OrbState;
  /** 0..1 mic amplitude — gently breathes the rings while listening. */
  amplitude?: number;
  className?: string;
}

/**
 * MagicRings — concentric reactive luminous rings centered on (and sitting behind)
 * the voice Orb. A taste-driven, LIGHT adaptation of the owner's three.js "MagicRings":
 * NOT a WebGL port. There is exactly ONE inline <svg> with four <ellipse> rings + two
 * reusable stroke gradients + one soft outer-glow filter.
 *
 * Cost: GSAP animates ONLY transforms (rotation/scale) and opacity on those nodes (no
 * layout, no second renderer/shader). The 4 infinite counter-rotation tweens are built
 * EXACTLY ONCE per state change (amplitude is deliberately OUT of the useGSAP deps, and
 * revertOnUpdate cleanly kills the old tweens before each rebuild — without it,
 * @gsap/react's deferCleanup path would only revert on unmount and leak tweens). The
 * listening amplitude "breathe" is a reused gsap.quickTo, so the ~60fps amplitude
 * updates cost two setter calls per frame — never a tween rebuild.
 *
 * Reduced motion → a static concentric set, recolored by state, no rotation/breathing.
 */

interface RingMotion {
  /** Rotation period in s per ring — HIGHER = slower. */
  spin: number;
  /** Base group opacity 0..1 (listening also adds amplitude). */
  opacity: number;
  /** Lead stroke color — shifts toward responding-blue when responding. */
  lead: string;
}

function ringMotion(state: OrbState): RingMotion {
  switch (state) {
    // Calm cyan, slow drift.
    case "listening":  return { spin: 30, opacity: 0.55, lead: "#5cf2ff" };
    // Brighter + faster while thinking/working.
    case "thinking":   return { spin: 14, opacity: 0.8,  lead: "#5cf2ff" };
    case "working":    return { spin: 13, opacity: 0.82, lead: "#5cf2ff" };
    // Shift toward responding-blue + faster.
    case "responding": return { spin: 11, opacity: 0.85, lead: "#6fb6ff" };
    default:           return { spin: 34, opacity: 0.45, lead: "#5cf2ff" };
  }
}

// Ring geometry as a fraction of the orb radius. Inner ring hugs the orb rim;
// the outermost reaches ~1.9× the orb diameter. Varying stroke/dash/ellipticity
// makes them read as luminous magic rings rather than plain nested circles.
const RINGS = [
  { rf: 0.62, sw: 1.5, dash: "",          ry: 1.0,  glow: false },
  { rf: 0.78, sw: 1.0, dash: "2 10",      ry: 0.94, glow: true  },
  { rf: 0.9,  sw: 1.25, dash: "",         ry: 1.0,  glow: false },
  { rf: 0.95, sw: 0.75, dash: "1 7",      ry: 0.9,  glow: true  },
] as const;

export function MagicRings({ size, state, amplitude = 0, className }: MagicRingsProps) {
  const scope = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const m = ringMotion(state);
  const listening = state === "listening";
  // Box is ~1.9× the orb so the outermost ring + glow fit without clipping.
  const box = size * 1.9;
  const c = box / 2;
  // The orb radius in this coordinate space (orb diameter == `size`).
  const orbR = size / 2;
  const amp = Math.max(0, Math.min(1, amplitude));

  // Unique gradient/filter ids so two MagicRings instances can never collide on the
  // same document (#3 hardening — harmless today as a singleton, free to make safe).
  const rawId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const idLead = `mr-lead-${rawId}`;
  const idMercury = `mr-mercury-${rawId}`;
  const idGlow = `mr-glow-${rawId}`;

  // quickTo setters for the listening "breathe" — created once per state change and
  // reused across the ~60fps amplitude updates (no tween rebuild, no leak).
  const breathe = useRef<{
    op: ReturnType<typeof gsap.quickTo>;
    sc: ReturnType<typeof gsap.quickTo>;
  } | null>(null);

  useGSAP(
    () => {
      const rings = gsap.utils.toArray<SVGElement>("[data-ring]");
      const group = scope.current?.querySelector<SVGGElement>("[data-ring-group]");
      breathe.current = null;
      if (!group) return;

      if (reduced) {
        // Static pretty state: parked rotation, state-tinted opacity, no breathing.
        gsap.set(rings, { rotation: 0, transformOrigin: "center" });
        gsap.set(group, { scale: 1, opacity: m.opacity, transformOrigin: "center" });
        return;
      }

      // Each ring counter-rotates: alternate direction, slightly stagger the speed
      // so they never visually lock together. Transform-only, infinite, linear.
      // Built once per state change (amp is NOT a dep; revertOnUpdate kills the prior set).
      rings.forEach((ring, i) => {
        const dir = i % 2 === 0 ? 1 : -1;
        const dur = m.spin * (1 + i * 0.18);
        gsap.set(ring, { transformOrigin: "center" });
        gsap.to(ring, { rotation: dir * 360, duration: dur, ease: "none", repeat: -1 });
      });

      // Base group opacity for this state; the breathe quickTo layers amplitude on top.
      gsap.set(group, { transformOrigin: "center", opacity: m.opacity, scale: 1 });
      breathe.current = {
        op: gsap.quickTo(group, "opacity", { duration: 0.45, ease: "power2.out" }),
        sc: gsap.quickTo(group, "scale", { duration: 0.45, ease: "power2.out" }),
      };
    },
    { scope, revertOnUpdate: true, dependencies: [state, reduced, m.spin, m.opacity] },
  );

  // Listening amplitude breathe: cheap imperative retarget of the SAME two tweens, so
  // amp updating ~60fps costs two setter calls per frame — NOT a tween rebuild. `amp` is
  // deliberately kept OUT of the useGSAP deps above so the infinite tweens aren't rebuilt.
  useEffect(() => {
    const b = breathe.current;
    if (!b) return;
    b.op(listening ? Math.min(1, m.opacity + amp * 0.35) : m.opacity);
    b.sc(listening ? 1 + amp * 0.06 : 1);
  }, [amp, listening, m.opacity]);

  return (
    <div
      ref={scope}
      className={className}
      aria-hidden="true"
      style={{ position: "relative", width: box, height: box, pointerEvents: "none" }}
    >
      <svg
        width={box}
        height={box}
        viewBox={`0 0 ${box} ${box}`}
        style={{ position: "absolute", inset: 0, overflow: "visible" }}
      >
        <defs>
          {/* Cyan → mercury → transparent sweep so each ring fades around its arc. */}
          <linearGradient id={idLead} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={m.lead} stopOpacity="0.9" />
            <stop offset="45%" stopColor="#9fc6d4" stopOpacity="0.65" />
            <stop offset="100%" stopColor={m.lead} stopOpacity="0" />
          </linearGradient>
          <linearGradient id={idMercury} x1="100%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#eaf6fa" stopOpacity="0.75" />
            <stop offset="50%" stopColor="#9fc6d4" stopOpacity="0.4" />
            <stop offset="100%" stopColor={m.lead} stopOpacity="0" />
          </linearGradient>
          {/* Soft outer glow — used sparingly (only the two dashed filament rings). */}
          <filter id={idGlow} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation={size * 0.018} result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g data-ring-group style={{ opacity: m.opacity }}>
          {RINGS.map((r, i) => (
            <ellipse
              key={i}
              data-ring
              cx={c}
              cy={c}
              rx={orbR * r.rf * 1.9}
              ry={orbR * r.rf * 1.9 * r.ry}
              fill="none"
              stroke={i % 2 === 0 ? `url(#${idLead})` : `url(#${idMercury})`}
              strokeWidth={r.sw}
              strokeLinecap="round"
              strokeDasharray={r.dash || undefined}
              filter={r.glow ? `url(#${idGlow})` : undefined}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
