import { useRef } from "react";
import { gsap, useGSAP } from "../lib/gsap.js";
import { EASE } from "../lib/deckMotion.js";
import { Orb } from "../components/ava/Orb.js";
import { ShiningText } from "../components/ava/ShiningText.js";

export type ThinkingState = "thinking" | "executing" | "responding";

export interface ThinkingIndicatorProps {
  /** Live caption — humanized tool / sliced thought / "thinking…". */
  caption: string;
  /** Drives the chip label + color. */
  state: ThinkingState;
  /**
   * Running tool name. NOT shown on the chip (it already carries a glow-dot and
   * a long name overflows) — the tool surfaces in the humanized caption instead.
   * Kept on the props so the call site contract is stable.
   */
  tool?: string;
  /** Reduced-motion flag (passed from the parent's useReducedMotion). */
  reduced: boolean;
  className?: string;
}

const CHIP: Record<ThinkingState, { cls: string; label: string }> = {
  thinking: { cls: "chip chip-ac", label: "THINKING" },
  executing: { cls: "chip chip-exec", label: "EXECUTING" },
  responding: { cls: "chip chip-live", label: "RESPONDING" },
};

/**
 * The premium in-stream "thinking" indicator. Left-aligned, sharing the assistant
 * bubble's geometry so the answer replaces it without a layout jump. Hosts the
 * re-hosted `flipId="ava-orb"` (the header orb flies INTO this), a state chip, and
 * a cyan/mercury ShiningText caption.
 *
 * The slow mercury breath (2.2s, scale + opacity yoyo) is the envelope around the
 * static size-22 Orb disc — NOT a spinner. Reduced motion → a static lit row, no
 * breath. Mount this gated on `optimisticThinking && !lastFinal` so exactly one
 * `ava-orb` is ever in the DOM (the final block's orb must NOT carry flipId).
 */
export function ThinkingIndicator({ caption, state, tool, reduced, className }: ThinkingIndicatorProps) {
  const scope = useRef<HTMLDivElement>(null);
  const breathRef = useRef<gsap.core.Tween | null>(null);

  useGSAP(
    () => {
      if (reduced) return;
      const row = scope.current?.querySelector("[data-thinking-inner]");
      if (!row) return;
      breathRef.current = gsap.to(row, {
        scale: 1.015,
        opacity: 0.85,
        duration: 2.2,
        yoyo: true,
        repeat: -1,
        ease: EASE,
        transformOrigin: "left center",
      });
      return () => breathRef.current?.kill();
    },
    { scope, dependencies: [reduced] },
  );

  const chip = CHIP[state];
  // Keep the chip label SHORT (it already carries a ::before glow-dot). The tool
  // surfaces only in the humanized ShiningText caption — a long tool name on the
  // chip could overflow the bubble. `tool` stays in the props for callers but is
  // no longer concatenated onto the chip.
  void tool;

  return (
    <div ref={scope} data-thinking className={className}>
      <div data-thinking-inner className="flex items-start gap-3 max-w-[88%]">
        <div className="shrink-0 mt-1">
          <Orb state="working" size={22} flipId="ava-orb" />
        </div>
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <span className={chip.cls}>{chip.label}</span>
          <ShiningText text={caption} className="shine-deck text-xs" reduced={reduced} />
        </div>
      </div>
    </div>
  );
}
