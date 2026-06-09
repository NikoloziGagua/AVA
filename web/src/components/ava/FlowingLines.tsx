import { useRef, type CSSProperties } from "react";
import { gsap, useGSAP, ScrollTrigger } from "../../lib/gsap.js";
import { useReducedMotion } from "../../lib/useReducedMotion.js";
import { D, EASE } from "../../lib/deckMotion.js";

export interface FlowingLinesProps {
  /** Working/executing mode — the bundle warms toward exec amber and quickens. */
  charged?: boolean;
  /** The real scroll element (the MessageList scroll div) for the parallax drift. */
  scrollerRef?: React.RefObject<HTMLElement | null>;
  /**
   * The scroll node identity (state-tracked). Drives the parallax effect's
   * re-init when the scroller is replaced on a session switch — the stable
   * `scrollerRef` object alone wouldn't re-trigger the ScrollTrigger setup.
   */
  scrollerNode?: HTMLElement | null;
  className?: string;
}

/**
 * Chat hero background: a slow, looping bundle of cyan/mercury flowing lines,
 * GSAP-driven (one timeline animates strokeDashoffset across all paths) under a
 * radial vignette + legibility scrim. Replaces EtherealShadows on chat.
 *
 * Perf: 16 paths total (8 per mirrored group — NOT the source's 72), animated
 * via the compositor-cheap `attr strokeDashoffset` (no layout/reflow). ONE
 * always-on effect: the slow dash draw. Opacity is animated ONCE on the single
 * wrapper layer (a calm breathe), NOT per-path — so there's no stack of
 * continuous per-path SVG repaints. The timeline pauses when the tab is hidden.
 * `charged` warms the strokes + speeds the timeline. Reduced motion → a frozen
 * lit bundle, no loops, no scroll, color applied static.
 */

const COUNT = 8; // paths per mirrored group (i = 0,3,6,…,21)

/** Base stroke opacity ramped 0.04 → 0.16 across the bundle (low = atmosphere). */
function baseOp(i: number): number {
  return 0.04 + (i / (COUNT - 1)) * 0.12;
}

/** The verified FloatingPaths cubic, coarser step so 12 reads as a full bundle. */
function pathD(idx: number, position: number): string {
  const i = idx * 3; // 0,3,…,33
  return `M-${380 - i * 5 * position} -${189 + i * 6}C-${380 - i * 5 * position} -${189 + i * 6} -${312 - i * 5 * position} ${216 - i * 6} ${152 - i * 5 * position} ${343 - i * 6}C${616 - i * 5 * position} ${470 - i * 6} ${684 - i * 5 * position} ${875 - i * 6} ${684 - i * 5 * position} ${875 - i * 6}`;
}

function Group({ position }: { position: number }) {
  return (
    <g>
      {Array.from({ length: COUNT }, (_, idx) => {
        const i = idx * 3;
        // Even paths → cyan, odd → mercury. color-mix lets the --warm tween shift
        // them toward exec amber without re-setting per-path stroke from JS.
        const lead = idx % 2 === 0 ? "var(--lines-cyan)" : "var(--lines-mercury)";
        return (
          <path
            key={idx}
            data-flowline
            d={pathD(idx, position)}
            fill="none"
            strokeWidth={0.5 + i * 0.06}
            strokeOpacity={baseOp(idx)}
            stroke={`color-mix(in srgb, ${lead}, var(--lines-warm) calc(var(--warm, 0) * 55%))`}
            style={{ "--base-op": baseOp(idx) } as CSSProperties}
          />
        );
      })}
    </g>
  );
}

export function FlowingLines({ charged = false, scrollerRef, scrollerNode, className }: FlowingLinesProps) {
  const reduced = useReducedMotion();
  const scope = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const tlRef = useRef<gsap.core.Timeline | null>(null);

  // ── Looping dash draw (one timeline) + parallax (one ScrollTrigger) ──
  // Only the compositor-cheap strokeDashoffset draw runs per-path. The old
  // per-path opacity yoyo (24 continuous SVG repaints) is GONE — opacity now
  // breathes ONCE on the single wrapper layer. The timeline pauses on tab hide.
  useGSAP(
    () => {
      const paths = gsap.utils.toArray<SVGPathElement>("[data-flowline]");
      if (paths.length === 0) return;

      if (reduced) {
        paths.forEach((p) => {
          const len = p.getTotalLength();
          const op = parseFloat(getComputedStyle(p).getPropertyValue("--base-op")) || 0.1;
          gsap.set(p, { strokeDasharray: len, strokeDashoffset: 0, strokeOpacity: op });
        });
        return;
      }

      const tl = gsap.timeline({ repeat: -1, defaults: { ease: "none" } });
      paths.forEach((p) => {
        const len = p.getTotalLength();
        gsap.set(p, { strokeDasharray: len });
        // Compositor-cheap: animate the dash offset attribute, no layout.
        tl.to(p, { attr: { strokeDashoffset: -len }, duration: gsap.utils.random(22, 30, 1, true) }, 0);
      });
      tlRef.current = tl;

      // ONE opacity breathe on the wrapper layer (cheap: a single composited
      // layer, not 16 per-path stroke repaints). yoyo sine around the rest 0.55.
      const breathe = layerRef.current
        ? gsap.to(layerRef.current, {
            opacity: 0.7,
            duration: 8,
            yoyo: true,
            repeat: -1,
            ease: "sine.inOut",
          })
        : null;

      // Pause both loops while the tab is hidden — no rAF / repaints offscreen.
      const onVisibility = () => {
        const paused = document.hidden;
        tl.paused(paused);
        breathe?.paused(paused);
      };
      document.addEventListener("visibilitychange", onVisibility);
      onVisibility();

      // Parallax: exactly one ScrollTrigger on the real scroll element.
      const scroller = scrollerRef?.current;
      let st: ScrollTrigger | undefined;
      if (scroller) {
        st = ScrollTrigger.create({
          scroller,
          trigger: scroller,
          start: "top top",
          end: "bottom bottom",
          scrub: 0.6,
          onUpdate: (self) => {
            if (svgRef.current) gsap.set(svgRef.current, { yPercent: -6 * self.progress });
          },
        });
      }
      return () => {
        document.removeEventListener("visibilitychange", onVisibility);
        st?.kill();
        breathe?.kill();
        tl.kill();
      };
    },
    // `scrollerNode` (the state-tracked node identity) is what re-inits the
    // parallax when the scroller is swapped on a session switch.
    { scope, dependencies: [reduced, scrollerNode] },
  );

  // ── charged: warm tint + quicken (felt, not a banner). Skip when reduced. ──
  useGSAP(
    () => {
      if (reduced) return;
      if (tlRef.current) gsap.to(tlRef.current, { timeScale: charged ? 1.3 : 1, duration: D.screen, ease: EASE });
      if (svgRef.current) gsap.to(svgRef.current, { "--warm": charged ? 1 : 0, duration: D.screen, ease: EASE });
    },
    { scope, dependencies: [charged, reduced] },
  );

  return (
    <div
      ref={scope}
      aria-hidden="true"
      className={className}
      style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}
    >
      {/* The lines, behind a radial vignette mask so the edges dissolve. The
          single opacity breathe (when motion is allowed) animates THIS layer. */}
      <div
        ref={layerRef}
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.55,
          willChange: "opacity",
          maskImage: "radial-gradient(ellipse 90% 75% at 50% 40%, black 0%, transparent 78%)",
          WebkitMaskImage: "radial-gradient(ellipse 90% 75% at 50% 40%, black 0%, transparent 78%)",
        }}
      >
        <svg
          ref={svgRef}
          viewBox="0 0 696 316"
          preserveAspectRatio="xMidYMid slice"
          fill="none"
          aria-hidden="true"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        >
          <Group position={1} />
          <Group position={-1} />
        </svg>
      </div>

      {/* Legibility scrim above the lines — keeps text crisp under the nav pill
          (top) and over the composer (bottom). */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.45) 0%, transparent 22%, transparent 68%, rgba(0,0,0,0.6) 100%)",
        }}
      />
    </div>
  );
}
