import { useId } from "react";
import { useReducedMotion } from "../../lib/useReducedMotion.js";

export interface EtherealShadowsProps {
  /** Working/executing mode — the field quickens and warms toward exec amber. */
  charged?: boolean;
  className?: string;
}

/**
 * Chat surface background: a slow, undulating field of cyan/violet "ethereal
 * shadows" — soft colored smoke warped by an SVG turbulence + displacement
 * filter, under a fine noise grain and a legibility scrim so the conversation
 * stays readable. `charged` is the working/executing state (quicker drift, a
 * warm ember tint). Decorative only.
 *
 * Perf note: the animated turbulence re-rasterizes the filter each frame, so it
 * is intentionally slow + low-octave, and reduced motion drops to a static
 * blurred gradient (no SVG, no filter animation). Tuned for the desktop surface.
 */
export function EtherealShadows({ charged = false, className }: EtherealShadowsProps) {
  const reduced = useReducedMotion();
  // useId() can contain ":" which is invalid inside url(#…) — strip it.
  const filterId = useId().replace(/:/g, "");
  const animate = !reduced;

  // Drift speed + warp strength. Charged = livelier and a touch stronger.
  const dur = charged ? 14 : 26; // seconds per undulation cycle
  const baseLo = "0.006 0.010";
  const baseHi = charged ? "0.016 0.022" : "0.012 0.018";
  const scale = charged ? 64 : 48;

  return (
    <div
      aria-hidden="true"
      className={className}
      style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}
    >
      {/* Color field — cyan + violet (+ a warm exec ember when charged), warped */}
      <div
        style={{
          position: "absolute",
          inset: "-12%",
          filter: animate ? `url(#${filterId}) blur(14px)` : "blur(26px)",
          opacity: 0.9,
          backgroundColor: "#04060e",
          backgroundImage:
            "radial-gradient(50% 55% at 22% 28%, rgba(92,242,255,0.42), transparent 70%)," +
            "radial-gradient(45% 50% at 78% 36%, rgba(124,92,255,0.40), transparent 72%)," +
            "radial-gradient(60% 60% at 60% 82%, rgba(57,255,176,0.16), transparent 75%)," +
            (charged
              ? "radial-gradient(40% 45% at 42% 60%, rgba(255,212,121,0.22), transparent 70%),"
              : "") +
            "radial-gradient(80% 80% at 50% 50%, rgba(4,6,14,0), rgba(4,6,14,0.6) 100%)",
          transition: "filter 600ms ease",
        }}
      />

      {animate && (
        <svg width="0" height="0" aria-hidden="true" style={{ position: "absolute" }}>
          <defs>
            <filter id={filterId} x="-20%" y="-20%" width="140%" height="140%">
              <feTurbulence
                type="fractalNoise"
                baseFrequency={baseLo}
                numOctaves={2}
                seed={7}
                result="noise"
              >
                <animate
                  attributeName="baseFrequency"
                  dur={`${dur}s`}
                  values={`${baseLo};${baseHi};${baseLo}`}
                  keyTimes="0;0.5;1"
                  calcMode="spline"
                  keySplines="0.45 0 0.55 1;0.45 0 0.55 1"
                  repeatCount="indefinite"
                />
              </feTurbulence>
              <feDisplacementMap
                in="SourceGraphic"
                in2="noise"
                scale={scale}
                xChannelSelector="R"
                yChannelSelector="G"
              />
            </filter>
          </defs>
        </svg>
      )}

      {/* Fine noise grain (self-contained data-URI; isolated document, safe id) */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.05,
          mixBlendMode: "overlay",
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />

      {/* Legibility scrim — keeps message text readable over the field */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(180deg, rgba(4,5,10,0.5) 0%, rgba(4,5,10,0.74) 52%, rgba(4,5,10,0.88) 100%)",
        }}
      />
    </div>
  );
}
