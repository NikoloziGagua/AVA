import { useReducedMotion } from "../../lib/useReducedMotion.js";

/**
 * Drifting nebula glow for the home + voice surfaces. Sits behind/above the
 * three.js DottedSurface to add colored depth. Decorative only; reduced motion
 * freezes the drift.
 */
export function NebulaBackground({ className }: { className?: string }) {
  const reduced = useReducedMotion();
  return (
    <div
      aria-hidden="true"
      className={className}
      style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}
    >
      <div
        style={{
          position: "absolute",
          inset: "-12%",
          filter: "blur(36px)",
          background:
            "radial-gradient(32% 50% at 26% 40%, rgba(124,92,255,0.42), transparent 62%)," +
            "radial-gradient(38% 52% at 74% 28%, rgba(34,140,255,0.38), transparent 62%)," +
            "radial-gradient(28% 44% at 54% 16%, rgba(92,242,255,0.28), transparent 62%)",
          animation: reduced ? undefined : "nebula-drift 20s ease-in-out infinite alternate",
        }}
      />
    </div>
  );
}
