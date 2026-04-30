import { motion } from "motion/react";

export interface HoverHaloProps {
  /** rgb triple, e.g. "168,85,247". Used for the bright spot on hover. */
  accent?: string;
  /** Border width in px. */
  borderWidth?: number;
  /** Rotation period in seconds when idle (subtle) and hovered (bright). */
  idleDurationS?: number;
  hoverDurationS?: number;
  /** Whether the halo is currently hovered (driven by parent). */
  hovered: boolean;
  /** Border radius — pass "9999px" for a circle. */
  borderRadius?: string;
  className?: string;
}

/**
 * Animated halo that traces a rotating bright arc around a rounded element's
 * border. Always animating subtly; brightens + speeds up on hover.
 *
 * Usage:
 *   <button className="relative ...">
 *     <HoverHalo hovered={hovered} accent="168,85,247" />
 *     <span className="relative ...">{children}</span>
 *   </button>
 */
export function HoverHalo({
  accent = "255,255,255",
  borderWidth = 1,
  idleDurationS = 6,
  hoverDurationS = 1.6,
  hovered,
  borderRadius = "9999px",
  className,
}: HoverHaloProps) {
  return (
    <span
      aria-hidden="true"
      className={"absolute inset-0 pointer-events-none overflow-hidden " + (className ?? "")}
      style={{ borderRadius }}
    >
      <motion.span
        className="absolute inset-0"
        style={{
          background: `conic-gradient(from 0deg, transparent 0%, rgba(${accent},${hovered ? 0.95 : 0.45}) 22%, transparent 45%)`,
          padding: borderWidth,
          WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
          WebkitMaskComposite: "xor",
          maskComposite: "exclude",
          borderRadius,
        }}
        animate={{ rotate: 360 }}
        transition={{
          duration: hovered ? hoverDurationS : idleDurationS,
          repeat: Infinity,
          ease: "linear",
        }}
      />
    </span>
  );
}
