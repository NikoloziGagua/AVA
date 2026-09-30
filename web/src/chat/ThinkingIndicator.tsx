import { cn } from "../design/cn.js";

export type ThinkingState = "thinking" | "executing" | "responding";

export interface ThinkingIndicatorProps {
  /** Live caption — humanized tool / sliced thought / "thinking…". */
  caption: string;
  state: ThinkingState;
  /** Running tool name; the humanized caption already names it. */
  tool?: string;
  /** Reduced motion: the dots hold still (the design root also stops them). */
  reduced: boolean;
  className?: string;
}

const WORD: Record<ThinkingState, string> = {
  thinking: "Thinking",
  executing: "Working",
  responding: "Writing",
};

/**
 * Where AVA's reply is about to appear: three breathing dots, what she is doing
 * and, when there is one, what that is in words. The island at the top says the
 * same thing for anyone looking there.
 */
export function ThinkingIndicator({ caption, state, reduced, className }: ThinkingIndicatorProps) {
  // The default caption only repeats the word, so it is left out.
  const detail = caption.trim().toLowerCase() === "thinking…" ? "" : caption;
  return (
    <div data-thinking className={cn("flex min-w-0 items-center gap-3 py-1 text-meta", className)}>
      <span aria-hidden="true" className={cn("ds-dots flex shrink-0 gap-1", reduced && "ds-dots-still")}>
        <i /><i /><i />
      </span>
      <span className="shrink-0 font-medium text-ink">{WORD[state]}</span>
      {detail && <span className="min-w-0 truncate text-ink-2">{detail}</span>}
    </div>
  );
}
