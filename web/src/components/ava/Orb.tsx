import { useRef } from "react";
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

  useGSAP(
    () => {
      if (reduced) return;
      gsap.to("[data-orb-core]", { rotation: 360, repeat: -1, ease: "none", duration: m.spin });
      gsap.to("[data-orb-rim]", { opacity: m.rimOpacity, duration: 0.6, ease: "power2.out" });
      gsap.fromTo(
        "[data-orb-rim]",
        { scale: 0.97 },
        { scale: 1.05, repeat: -1, yoyo: true, duration: 1.7, ease: "sine.inOut" },
      );
      if (listening) {
        gsap.fromTo(
          "[data-orb-ripple]",
          { scale: 0.7, opacity: 0.5 },
          { scale: 1.9, opacity: 0, duration: 2.6, ease: "power1.out", repeat: -1, stagger: 0.9 },
        );
      }
    },
    { scope, dependencies: [state, reduced, m.spin, m.rimOpacity, listening] },
  );

  return (
    <div
      ref={scope}
      className={className}
      data-flip-id={flipId}
      style={{ position: "relative", width: size, height: size }}
    >
      {listening &&
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
          opacity: m.rimOpacity,
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
          animation: reduced ? undefined : `orb-morph ${m.morph}s ease-in-out infinite`,
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
