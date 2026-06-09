import { motion } from "motion/react";

/**
 * Shimmering gradient text. The shimmer is a Framer Motion loop (animated
 * backgroundPosition), so the CSS `prefers-reduced-motion` gate (which only
 * neutralizes CSS animations) does NOT stop it. Pass `reduced` to render a
 * static lit gradient with no loop — used by the thinking indicator so the
 * shimmer doesn't run forever under reduced motion.
 */
export function ShiningText({
  text,
  className,
  reduced = false,
}: {
  text: string;
  className?: string;
  reduced?: boolean;
}) {
  const base =
    "bg-[linear-gradient(110deg,#404040,35%,#fff,50%,#404040,75%,#404040)] " +
    "bg-[length:200%_100%] bg-clip-text text-transparent " +
    (className ?? "");

  if (reduced) {
    // Static: park the highlight mid-text, no animate/repeat.
    return (
      <span className={base} style={{ backgroundPosition: "0 0" }}>
        {text}
      </span>
    );
  }

  return (
    <motion.span
      className={base}
      initial={{ backgroundPosition: "200% 0" }}
      animate={{ backgroundPosition: "-200% 0" }}
      transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
    >
      {text}
    </motion.span>
  );
}
