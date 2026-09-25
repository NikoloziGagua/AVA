import { cn } from "./cn.js";

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
export function StatusIsland({ mode, text, detail, time, className }: {
  mode: IslandMode;
  /** Replaces the default word for the mode. */
  text?: string;
  /** A short extra, e.g. the task AVA is working on. */
  detail?: string;
  time?: string;
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
        <span aria-hidden="true" className="ds-island-bars flex h-3.5 items-center gap-0.5">
          <i /><i /><i /><i />
        </span>
      ) : (
        <span aria-hidden="true" className={cn("ds-island-dot h-2 w-2 rounded-full bg-on-solid", mode === "attention" && "bg-warning")} />
      )}
      <span>{label}</span>
      {detail && <span className="min-w-0 truncate opacity-70">· {detail}</span>}
      {time && <span className="font-ui-mono text-label opacity-60">{time}</span>}
    </div>
  );
}
