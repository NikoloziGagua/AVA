import { useEffect, useRef } from "react";
import { gsap, useGSAP } from "../../lib/gsap.js";
import { useReducedMotion } from "../../lib/useReducedMotion.js";
import { orbMotion, type OrbState } from "./orb-state.js";

export interface OrbProps {
  /** Diameter in px. */
  size?: number;
  state?: OrbState;
  /** 0..1 mic amplitude — brightens the rim + drives ripples when listening. */
  amplitude?: number;
  /** Stable id so GSAP Flip can animate the same orb between home/chat/voice. */
  flipId?: string;
  className?: string;
}

/**
 * Ava's living mercury orb — the canonical avatar/hero across every surface.
 * GSAP drives continuous rotation, the rim pulse, and (when listening) the
 * outward ripples; CSS handles the organic blob morph. Reduced motion → static.
 */
export function Orb({ size = 120, state = "idle", amplitude = 0, flipId, className }: OrbProps) {
  const scope = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const m = orbMotion(state, amplitude);
  const listening = state === "listening";
  // Only the large hero orbs (home/voice) animate. Small avatars (chat header,
  // every message avatar, composer — ~14–28px) render as a STATIC mercury disc:
  // a long chat would otherwise spin up ~20 infinite GSAP timelines + morphing
  // conic-gradient repaints and choke the main thread.
  const animate = !reduced && size >= 40;

  // Reused setter so the rim's amplitude-tracked opacity is driven WITHOUT rebuilding
  // any tween (see the amplitude effect below). Null for static avatars.
  const rimOpacityTo = useRef<ReturnType<typeof gsap.quickTo> | null>(null);

  useGSAP(
    () => {
      rimOpacityTo.current = null;
      if (!animate) return;
      const rim = scope.current?.querySelector<HTMLDivElement>("[data-orb-rim]");
      gsap.to("[data-orb-core]", { rotation: 360, repeat: -1, ease: "none", duration: m.spin });
      if (rim) {
        // Rim opacity is GSAP-owned (the inline style omits it while animating) so the
        // ~60fps amplitude-prop re-renders never fight the tween. It's driven live by the
        // amplitude effect below via a reused quickTo — which is why the amp-derived
        // m.rimOpacity is no longer a useGSAP dependency: keeping it here made the whole
        // body (core spin + ripples included) re-run and accumulate tweens every frame.
        gsap.set(rim, { opacity: m.rimOpacity });
        rimOpacityTo.current = gsap.quickTo(rim, "opacity", { duration: 0.4, ease: "power2.out" });
        gsap.fromTo(rim, { scale: 0.97 }, { scale: 1.05, repeat: -1, yoyo: true, duration: 1.7, ease: "sine.inOut" });
      }
      if (listening) {
        gsap.fromTo(
          "[data-orb-ripple]",
          { scale: 0.7, opacity: 0.5 },
          { scale: 1.9, opacity: 0, duration: 2.6, ease: "power1.out", repeat: -1, stagger: 0.9 },
        );
      }
    },
    { scope, dependencies: [state, reduced, animate, m.spin, listening] },
  );

  // Rim brightness tracks mic amplitude while listening (orbMotion folds amp into
  // rimOpacity). A reused quickTo means a 60fps amplitude change is one setter call, not
  // a tween rebuild. No-op for static avatars (rimOpacityTo is null when !animate).
  useEffect(() => {
    rimOpacityTo.current?.(orbMotion(state, amplitude).rimOpacity);
  }, [amplitude, state]);

  return (
    <div
      ref={scope}
      className={className}
      data-flip-id={flipId}
      style={{ position: "relative", width: size, height: size }}
    >
      {animate && listening &&
        [0, 1, 2].map((i) => (
          <span
            key={i}
            data-orb-ripple
            aria-hidden="true"
            style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "1px solid var(--ac)", opacity: 0 }}
          />
        ))}

      <div
        data-orb-rim
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: "-7%",
          borderRadius: "50%",
          border: "1px solid var(--ac)",
          // While animating, GSAP owns rim opacity (quickTo) — omit it inline so a
          // 60fps amplitude re-render can't reset it and fight the tween. Static
          // avatars get the amplitude-independent base.
          opacity: animate ? undefined : orbMotion(state, 0).rimOpacity,
          boxShadow: `0 0 ${size * 0.22}px rgba(92,242,255,0.45)`,
        }}
      />

      <div
        data-orb-core
        className="mercury"
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          boxShadow: `0 0 ${size * 0.4}px rgba(92,242,255,0.4), inset 0 0 ${size * 0.2}px rgba(255,255,255,0.5)`,
          animation: animate ? `orb-morph ${m.morph}s ease-in-out infinite` : undefined,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            left: "18%",
            top: "15%",
            width: "34%",
            height: "30%",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(255,255,255,0.95), rgba(255,255,255,0) 62%)",
            filter: "blur(4px)",
          }}
        />
      </div>
    </div>
  );
}
