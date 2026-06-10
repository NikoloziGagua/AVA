import { useRef } from "react";
import type { CSSProperties } from "react";
import { gsap, useGSAP, SplitText } from "../../lib/gsap.js";
import { useReducedMotion } from "../../lib/useReducedMotion.js";

export interface StreamingRevealProps {
  /** The full accumulated streamed text so far (grows as deltas arrive). */
  text: string;
  className?: string;
  style?: CSSProperties;
  /**
   * Vertical text gradient, clipped ONCE on the host div so the silver fill
   * spans the whole growing message (no per-chunk banding / seam shift).
   */
  gradient?: string;
  /** Reduced-motion override (falls back to the hook). */
  reduced?: boolean;
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
 * Live word-by-word reveal for a STREAMING assistant reply. Unlike WordReveal
 * (a one-shot mount reveal of complete text), this grows as `text` lengthens
 * and animates ONLY the newly-arrived words on each delta — never re-splitting
 * or re-animating the already-revealed prefix, which is the jank to avoid.
 *
 * Technique: React owns an empty host <div>; GSAP owns its children imperatively.
 * A high-water mark (`committedRef`) tracks how many chars are already on screen.
 * Each render appends a single <span> holding only the new tail, runs SplitText
 * on THAT span alone (O(new words), not O(total)), and animates its words in.
 * Old word-spans are inert DOM with no live tween. `clearProps` hands committed
 * words back to normal flow so the browser isn't compositing the whole message.
 *
 * Reduced motion / SSR / jsdom tests: plain growing text, zero GSAP, no SplitText.
 */
export function StreamingReveal({ text, className, style, gradient, reduced: reducedProp }: StreamingRevealProps) {
  const reducedHook = useReducedMotion();
  const reduced = reducedProp ?? reducedHook;
  const hostRef = useRef<HTMLDivElement>(null);
  // Chars already rendered + animated into the host. Reset when the text shrinks
  // (a new run reusing this mounted instance) so we don't slice past the end.
  const committedRef = useRef(0);

  useGSAP(
    () => {
      if (reduced) return;
      const host = hostRef.current;
      if (!host) return;

      // A shorter `text` than what we've committed means this is a fresh stream
      // (new run) on a reused instance — rebuild from scratch.
      if (text.length < committedRef.current) {
        host.replaceChildren();
        committedRef.current = 0;
      }

      const fresh = text.slice(committedRef.current);
      if (!fresh) return;
      committedRef.current = text.length;

      // Append ONE span holding only the new chunk; split + animate only it.
      // The gradient lives ONCE on the host (background-clip:text), so each
      // chunk span just inherits the single clipped fill — no per-chunk
      // background, which would otherwise re-start the gradient at every chunk
      // boundary (banding) and shift color at the streaming→final seam.
      const chunk = document.createElement("span");
      chunk.textContent = fresh;
      chunk.style.color = "inherit";
      host.appendChild(chunk);

      const split = new SplitText(chunk, { type: "words", wordsClass: "sr-word" });
      gsap.set(split.words, { display: "inline-block", whiteSpace: "pre-wrap" });
      gsap.from(split.words, {
        opacity: 0,
        yPercent: 18,
        filter: "blur(8px)",
        duration: 0.34,
        ease: "power3.out",
        stagger: 0.028,
        // Settle committed words back to plain flow — no lingering transforms.
        clearProps: "filter,transform",
      });
      // Do NOT split.revert(): the word spans ARE the committed DOM going forward.
    },
    { dependencies: [text] },
  );

  if (reduced) {
    return (
      <div className={className} style={{ ...style, ...gradientStyle(gradient) }}>
        {text}
      </div>
    );
  }

  // Gradient applied ONCE here so the clipped silver fill spans the entire
  // growing message; each appended chunk span inherits it (color:inherit) and
  // SplitText word spans inherit through them — matching the final WordReveal.
  return (
    <div
      ref={hostRef}
      className={className}
      style={{ ...style, ...gradientStyle(gradient) }}
      aria-live="polite"
    />
  );
}
