import { motion, type Variants } from "motion/react";
import type { CSSProperties } from "react";
import { useReducedMotion } from "../../lib/useReducedMotion.js";

export interface WordRevealProps {
  text: string;
  className?: string;
  style?: CSSProperties;
  /** Vertical text gradient, clipped per word so the silver fill is preserved. */
  gradient?: string;
  /**
   * When false, render the text plainly with no entrance animation. Used by the
   * final block of a turn that already revealed its words live. Defaults to true.
   */
  animate?: boolean;
}

function gradientStyle(gradient?: string): CSSProperties {
  if (!gradient) return {};
  return {
    backgroundImage: gradient,
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    color: "transparent",
  };
}

// Container orchestrates the per-word stagger. The staggerChildren MUST live in the
// container variant's transition (not as a bare `transition` prop) — otherwise Framer
// Motion animates every word at once and the reply just "appears" instead of revealing
// word-by-word. Each word carries its own enter variant.
const container: Variants = {
  hidden: {},
  visible: (stagger: number) => ({ transition: { staggerChildren: stagger } }),
};
const wordVariant: Variants = {
  hidden: { opacity: 0, filter: "blur(10px)", y: 4 },
  visible: { opacity: 1, filter: "blur(0px)", y: 0, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] } },
};

/**
 * Reveals a block of text WORD-BY-WORD with a quick blur-up stagger. One-shot enter on
 * mount; total time-boxed so long answers don't crawl. Reduced motion / animate=false
 * render plainly. The gradient is clipped per word so the silver fill stays intact.
 */
export function WordReveal({ text, className, style, gradient, animate = true }: WordRevealProps) {
  const reduced = useReducedMotion();

  if (reduced || !text || !animate) {
    return (
      <div className={className} style={{ ...style, ...gradientStyle(gradient) }}>
        {text}
      </div>
    );
  }

  // Split keeping whitespace so spaces and newlines survive (container wraps).
  const tokens = text.split(/(\s+)/);
  const wordCount = tokens.filter((t) => t && !/^\s+$/.test(t)).length || 1;
  const stagger = Math.min(0.045, 1.1 / wordCount); // per-word delay, time-boxed for long answers

  return (
    <motion.div
      className={className}
      style={style}
      variants={container}
      custom={stagger}
      initial="hidden"
      animate="visible"
    >
      {tokens.map((tok, i) =>
        /^\s+$/.test(tok) ? (
          <span key={i} style={{ whiteSpace: "pre-wrap" }}>
            {tok}
          </span>
        ) : (
          <motion.span
            key={i}
            variants={wordVariant}
            style={{ display: "inline-block", whiteSpace: "pre-wrap", ...gradientStyle(gradient) }}
          >
            {tok}
          </motion.span>
        ),
      )}
    </motion.div>
  );
}
