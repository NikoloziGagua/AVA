import { useReducedMotion } from "../../lib/useReducedMotion.js";

export interface RainBackgroundProps {
  /** Working/executing mode — rain speeds up + brightens. */
  charged?: boolean;
  className?: string;
}

/**
 * Chat surface background: light-rain streaks falling behind a frosted dotted
 * veil, with a scrim so the conversation stays legible. `charged` is the
 * working/executing state. Decorative only; reduced motion freezes the fall.
 */
export function RainBackground({ charged = false, className }: RainBackgroundProps) {
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
          inset: 0,
          backgroundImage:
            "radial-gradient(3px 90px at 80px 0, rgba(92,242,255,0.7), transparent)," +
            "radial-gradient(2px 70px at 240px 0, rgba(124,92,255,0.6), transparent)," +
            "radial-gradient(3px 90px at 420px 0, rgba(92,242,255,0.65), transparent)," +
            "radial-gradient(2px 80px at 640px 0, rgba(92,242,255,0.6), transparent)," +
            "radial-gradient(3px 90px at 860px 0, rgba(124,92,255,0.6), transparent)," +
            "radial-gradient(2px 70px at 1040px 0, rgba(92,242,255,0.6), transparent)",
          backgroundSize: "180px 360px,180px 300px,180px 420px,180px 340px,180px 380px,180px 320px",
          backgroundRepeat: "repeat-y",
          filter: charged ? "brightness(1.5) saturate(1.3)" : undefined,
          animation: reduced ? undefined : `rain-fall ${charged ? 2.6 : 7}s linear infinite`,
        }}
      />
      {/* frosted dotted veil */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backdropFilter: "blur(2px)",
          WebkitBackdropFilter: "blur(2px)",
          backgroundImage: "radial-gradient(circle at 50% 50%, transparent 0, transparent 2px, rgba(3,4,10,0.92) 2px)",
          backgroundSize: "9px 9px",
        }}
      />
      {/* legibility scrim */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(180deg, rgba(4,5,10,0.55) 0%, rgba(4,5,10,0.8) 50%, rgba(4,5,10,0.9) 100%)",
        }}
      />
    </div>
  );
}
