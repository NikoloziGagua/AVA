import type { ActivityStep } from "./activity-steps.js";

export interface ActivityPanelProps {
  steps: ActivityStep[];
  collapsed: boolean;
  onToggle: () => void;
  /** Charged/working — shows the live pulse + brighter accent. */
  executing?: boolean;
}

const STATUS_GLYPH: Record<ActivityStep["status"], string> = { done: "✓", running: "⟳", queued: "○" };

/**
 * Right-docked, side-to-side collapsible step list. Collapsed → a thin edge tab
 * with a live count; expanded → the full Activity list. The parent owns the
 * `collapsed` state so the conversation can flex to full width.
 *
 * Below the `sm` breakpoint the panel takes NO layout width (a docked 280px
 * column left the conversation a one-word-per-line sliver): both states pin to
 * the right edge of the (relative) chat row — the tab floats mid-edge, the
 * expanded list overlays the conversation at ≤85vw/320px.
 */
export function ActivityPanel({ steps, collapsed, onToggle, executing }: ActivityPanelProps) {
  const doneCount = steps.filter((s) => s.status === "done").length;

  if (collapsed) {
    return (
      <button
        type="button"
        aria-label="show activity"
        onClick={onToggle}
        className="glass absolute right-0 top-1/2 z-20 flex -translate-y-1/2 cursor-pointer items-center gap-2 rounded-l-xl border-r-0 px-2 py-3 sm:static sm:translate-y-0 sm:flex-none sm:self-center"
        style={{ borderColor: "rgba(92,242,255,0.25)" }}
      >
        <span style={{ color: "var(--ac)", fontSize: 13 }}>⟨</span>
        {executing && (
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--ac-live)", boxShadow: "0 0 8px var(--ac-live)" }}
          />
        )}
        <span className="hud text-[8px] text-white/70" style={{ writingMode: "vertical-rl" }}>
          Activity · {doneCount} done
        </span>
      </button>
    );
  }

  return (
    <aside
      className="absolute inset-y-0 right-0 z-20 flex w-[min(85vw,320px)] flex-col p-3.5 sm:static sm:w-[280px] sm:flex-none"
      style={{
        borderLeft: "1px solid rgba(92,242,255,0.2)",
        background: "rgba(6,10,16,0.55)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
      }}
    >
      <div className="flex items-center gap-2">
        {executing && (
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--ac-live)", boxShadow: "0 0 8px var(--ac-live)" }}
          />
        )}
        <span className="hud text-[9px] text-white/45">Activity</span>
        <button
          type="button"
          aria-label="collapse activity"
          onClick={onToggle}
          className="ml-auto flex h-6 w-6 items-center justify-center rounded-md border"
          style={{ borderColor: "rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)", color: "var(--ac)" }}
        >
          ⟩
        </button>
      </div>

      <div className="no-scrollbar mt-3 flex flex-col overflow-y-auto">
        {steps.length === 0 ? (
          <div className="hud text-[9px] text-white/30">No activity yet</div>
        ) : (
          steps.map((s) => {
            const failed = s.status === "done" && s.ok === false;
            return (
              <div
                key={s.key}
                className="flex items-center gap-2.5 border-b py-1.5 text-[10.5px]"
                style={{
                  borderColor: "rgba(255,255,255,0.05)",
                  color: s.status === "running" ? "#eafdff" : "rgba(255,255,255,0.55)",
                  fontFamily: "var(--font-mono)",
                }}
                title={failed ? s.reasonFull ?? s.reason : undefined}
              >
                <span
                  style={{
                    width: 13,
                    textAlign: "center",
                    color: s.status === "done" ? (s.ok === false ? "var(--ac-stop)" : "var(--ac-live)") : s.status === "running" ? "var(--ac)" : "rgba(255,255,255,0.4)",
                  }}
                >
                  {STATUS_GLYPH[s.status]}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{s.label}</span>
                  {failed && s.reason && (
                    <span className="truncate text-[9px]" style={{ color: "var(--ac-stop)", opacity: 0.75 }}>
                      {s.reason}
                    </span>
                  )}
                </span>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
