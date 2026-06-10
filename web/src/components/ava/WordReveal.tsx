import { motion } from "motion/react";
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
   * final block of a STREAMED turn — the words already revealed live via
   * StreamingReveal, so re-animating the whole block on `final` would flash a
   * second reveal. Defaults to true (the normal one-shot mount reveal).
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

/**
 * Reveals a block of text word-by-word with a quick blur-up stagger — used for
 * Ava's fresh answers, which arrive as one `final` event (not token-streamed),
 * so this IS the reveal. One-shot enter on mount; the total is time-boxed so
 * long answers don't crawl. Reduced motion renders the text plainly. The text
 * gradient is clipped per word to keep the silver fill intact.
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
  const stagger = Math.min(0.022, 1.1 / wordCount); // time-box the whole reveal

  return (
    <motion.div
      className={className}
      style={style}
      initial="hidden"
      animate="visible"
      transition={{ staggerChildren: stagger }}
    >
      {tokens.map((tok, i) =>
        /^\s+$/.test(tok) ? (
          <span key={i} style={{ whiteSpace: "pre-wrap" }}>
            {tok}
          </span>
        ) : (
          <motion.span
            key={i}
            style={{ display: "inline-block", whiteSpace: "pre-wrap", ...gradientStyle(gradient) }}
            variants={{
              hidden: { opacity: 0, filter: "blur(10px)" },
              visible: { opacity: 1, filter: "blur(0px)" },
            }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            {tok}
          </motion.span>
        ),
      )}
    </motion.div>
  );
}
