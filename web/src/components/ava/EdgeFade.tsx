import type { CSSProperties } from "react";
import { useReducedMotion } from "../../lib/useReducedMotion.js";

export interface EdgeFadeProps {
  /** Which edge of the scroll container to fade. */
  edge: "top" | "bottom";
  /** Band height in px. */
  height?: number;
  /** Max blur (px) of the strip closest to the edge. */
  strength?: number;
  className?: string;
}

/**
 * GradualBlur-style edge fade for a scroll container. Pure CSS, no JS / no rAF.
 *
 * Three stacked, masked backdrop-blur strips (blur ramps from the edge inward via
 * a mask-image gradient, so it reads as a gradual fade, not a frosted band) plus
 * one non-filter tint strip (`--ava-bg → transparent`) so messages dissolve into
 * the substrate as they reach the nav / composer.
 *
 * Reduced motion → render only the tint strip (drop all backdrop-filter strips).
 * Mount inside the scroll container, pointer-events-none, z above messages /
 * below composer.
 */
export function EdgeFade({ edge, height = 64, strength = 9, className }: EdgeFadeProps) {
  const reduced = useReducedMotion();
  const top = edge === "top";

  const wrap: CSSProperties = {
    position: "absolute",
    left: 0,
    right: 0,
    [top ? "top" : "bottom"]: 0,
    height,
    pointerEvents: "none",
    zIndex: 5,
  };

  // Mask: full at the edge → transparent inward (so the blur ramps).
  const blurMask = top
    ? "linear-gradient(to bottom, black, transparent)"
    : "linear-gradient(to top, black, transparent)";
  // Tint: substrate color at the edge → transparent inward.
  const tintBg = top
    ? "linear-gradient(to bottom, var(--ava-bg), transparent)"
    : "linear-gradient(to top, var(--ava-bg), transparent)";

  function strip(heightPct: number, blur: number): CSSProperties {
    return {
      position: "absolute",
      left: 0,
      right: 0,
      [top ? "top" : "bottom"]: 0,
      height: `${heightPct}%`,
      backdropFilter: `blur(${blur}px)`,
      WebkitBackdropFilter: `blur(${blur}px)`,
      maskImage: blurMask,
      WebkitMaskImage: blurMask,
    };
  }

  return (
    <div aria-hidden="true" className={className} style={wrap}>
      {!reduced && (
        <>
          <div style={strip(100, 2)} />
          <div style={strip(66, 5)} />
          <div style={strip(33, strength)} />
        </>
      )}
      <div style={{ position: "absolute", inset: 0, background: tintBg }} />
    </div>
  );
}
