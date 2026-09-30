import { useEffect, useRef } from "react";
import { cn } from "./cn.js";
import { useReducedMotion } from "./motion.js";

export type IslandMode = "idle" | "listening" | "thinking" | "speaking" | "working" | "attention";

const DEFAULT_TEXT: Record<IslandMode, string> = {
  idle: "AVA",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  working: "Working",
  attention: "Needs you",
};

/**
 * What AVA is doing right now, at the top of Home, Talk and Voice. Grows a
 * little when there is more to say (speaking shows live voice bars; working
 * names the task). Announced politely to screen readers.
 */
export function StatusIsland({ mode, text, detail, time, action, sampleLevel, className }: {
  mode: IslandMode;
  /** Replaces the default word for the mode. */
  text?: string;
  /** A short extra, e.g. the task AVA is working on. */
  detail?: string;
  time?: string;
  /** One small control inside the island, e.g. "1 idea" on Home. */
  action?: { label: string; description?: string; onPress: () => void };
  /**
   * While speaking, read on every animation frame so the bars follow AVA's
   * measured voice without re-rendering. Null keeps the gentle rhythm.
   */
  sampleLevel?: () => number | null;
  className?: string;
}) {
  const label = text ?? DEFAULT_TEXT[mode];
  return (
    <div
      role="status"
      aria-live="polite"
      data-mode={mode}
      className={cn(
        "ds-island mx-auto flex h-9 w-fit max-w-full items-center gap-2.5 rounded-full bg-solid pl-3 pr-4 font-ui text-meta font-medium text-on-solid shadow-e1",
        "transition-[padding] duration-400 ease-spring",
        (mode === "speaking" || detail) && "pr-5",
        className,
      )}
    >
      {mode === "speaking" ? (
        <IslandBars sampleLevel={sampleLevel} />
      ) : (
        <span aria-hidden="true" className={cn("ds-island-dot h-2 w-2 rounded-full bg-on-solid", mode === "attention" && "bg-warning")} />
      )}
      <span>{label}</span>
      {detail && <span className="min-w-0 truncate opacity-70">· {detail}</span>}
      {action && (
        <button
          type="button"
          onClick={action.onPress}
          aria-label={action.description}
          className="ds-focus -my-1.5 rounded-full bg-on-solid/15 px-3 py-1.5 text-meta font-medium text-on-solid transition-colors duration-150 hover:bg-on-solid/25"
        >
          {action.label}
        </button>
      )}
      {time && <span className="font-ui-mono text-label opacity-60">{time}</span>}
    </div>
  );
}

const BAR_SHAPE = [0.55, 1, 0.75, 0.9];

/** Four voice bars: a gentle rhythm, or AVA's measured voice when there is one. */
function IslandBars({ sampleLevel }: { sampleLevel?: () => number | null }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el || !sampleLevel || reduced) return;
    const bars = [...el.querySelectorAll<HTMLElement>("i")];
    let raf = 0;
    const tick = () => {
      let value: number | null = null;
      try { value = sampleLevel(); } catch { value = null; }
      if (value === null || !Number.isFinite(value)) {
        el.dataset.live = "false";
        for (const bar of bars) bar.style.transform = "";
      } else {
        el.dataset.live = "true";
        const energy = Math.min(1, Math.max(0, value));
        bars.forEach((bar, at) => { bar.style.transform = `scaleY(${(0.25 + 0.75 * energy * BAR_SHAPE[at]!).toFixed(3)})`; });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      delete el.dataset.live;
      for (const bar of bars) bar.style.transform = "";
    };
  }, [sampleLevel, reduced]);
  return (
    <span ref={ref} aria-hidden="true" className="ds-island-bars flex h-3.5 items-center gap-0.5">
      <i /><i /><i /><i />
    </span>
  );
}
