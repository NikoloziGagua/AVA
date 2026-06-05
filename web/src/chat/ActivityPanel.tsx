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
 */
export function ActivityPanel({ steps, collapsed, onToggle, executing }: ActivityPanelProps) {
  const doneCount = steps.filter((s) => s.status === "done").length;

  if (collapsed) {
    return (
      <button
        type="button"
        aria-label="show activity"
        onClick={onToggle}
        className="glass flex flex-none cursor-pointer items-center gap-2 self-center rounded-l-xl border-r-0 px-2 py-3"
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
      className="flex w-[280px] flex-none flex-col p-3.5"
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
          steps.map((s) => (
            <div
              key={s.key}
              className="flex items-center gap-2.5 border-b py-1.5 text-[10.5px]"
              style={{
                borderColor: "rgba(255,255,255,0.05)",
                color: s.status === "running" ? "#eafdff" : "rgba(255,255,255,0.55)",
                fontFamily: "var(--font-mono)",
              }}
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
              <span className="truncate">{s.label}</span>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
