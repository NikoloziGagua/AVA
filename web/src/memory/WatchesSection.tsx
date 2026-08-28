import { useEffect, useState, type CSSProperties } from "react";
import { X } from "lucide-react";
import { deleteWatchApi, fetchWatches, setWatchEnabled, type WatchRow } from "../api.js";
import { PanelSection } from "../components/ava/PanelShell.js";
import { useGSAP } from "../lib/gsap.js";
import { useReducedMotion } from "../lib/useReducedMotion.js";
import { hoverLift } from "../lib/deckMotion.js";

/** Light refresh so last-check lines stay fresh while the panel is open. */
const REFRESH_MS = 30_000;

/**
 * Human schedule caption, rendered defensively: the run_at / daily_at / kind
 * columns are newer than the base schema and may be absent, null, or odd —
 * unknown shapes must degrade to a label, never crash.
 */
export function scheduleLabel(w: Partial<WatchRow>): string {
  const runAt = Number(w.run_at);
  if (w.run_at != null && Number.isFinite(runAt) && runAt > 0) {
    return `once at ${new Date(runAt).toLocaleString()}`;
  }
  if (typeof w.daily_at === "string" && w.daily_at.trim()) {
    return `daily at ${w.daily_at.trim()}`;
  }
  const n = Number(w.interval_minutes);
  if (Number.isFinite(n) && n > 0) {
    return w.once ? `every ${n} min · once` : `every ${n} min`;
  }
  return "schedule unknown";
}

/** Compact relative time for the last-check line ("just now", "4m ago"). */
export function timeAgo(ts: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// last_status → glyph. Unknown/missing statuses fall back to the "unclear" mark.
const STATUS_GLYPH = {
  ok: { glyph: "✓", cls: "text-white/40", label: "ok" },
  triggered: { glyph: "●", cls: "text-[var(--ac)]", label: "triggered" },
  error: { glyph: "✗", cls: "text-[var(--ac-stop)]", label: "error" },
  unclear: { glyph: "?", cls: "text-white/45", label: "unclear" },
  busy: { glyph: "◌", cls: "text-[var(--ac-warn)]", label: "waiting for target" },
  dispatching: { glyph: "↗", cls: "text-[var(--ac-exec)]", label: "dispatching" },
  delivered: { glyph: "●", cls: "text-[var(--ac-exec)]", label: "delivered" },
  running: { glyph: "◌", cls: "text-[var(--ac-exec)]", label: "running" },
  completed: { glyph: "✓", cls: "text-[var(--ac)]", label: "completed" },
} as const;

function statusGlyph(status: WatchRow["last_status"]) {
  return STATUS_GLYPH[status as keyof typeof STATUS_GLYPH] ?? STATUS_GLYPH.unclear;
}

/**
 * "Standing watches" — the read surface over Ava's long-term monitors
 * (GET /api/watches). Read-mostly: watches are created conversationally; here
 * Sir can see the schedule + last check, pause one (toggle), or delete it.
 */
export function WatchesSection() {
  const [rows, setRows] = useState<WatchRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetchWatches();
        if (!alive) return;
        setRows(r);
        setErr(null);
      } catch (e) {
        if (alive) setErr(String(e));
      }
    };
    void load();
    const t = window.setInterval(() => void load(), REFRESH_MS);
    return () => { alive = false; window.clearInterval(t); };
  }, []);

  async function toggle(w: WatchRow) {
    const next = !w.enabled;
    // Optimistic flip; a failed POST re-syncs from the server.
    setRows((prev) => prev?.map((x) => (x.id === w.id ? { ...x, enabled: next ? 1 : 0 } : x)) ?? prev);
    try {
      await setWatchEnabled(w.id, next);
    } catch {
      try { setRows(await fetchWatches()); } catch { /* keep optimistic state */ }
    }
  }

  async function remove(w: WatchRow) {
    try {
      await deleteWatchApi(w.id);
      setRows((prev) => prev?.filter((x) => x.id !== w.id) ?? prev);
    } catch (e) {
      setErr(String(e));
    }
  }

  return (
    <PanelSection
      title="Standing watches"
      span="lg:col-span-6"
      right={rows && rows.length > 0 ? <span className="chip chip-ac">{rows.length}</span> : undefined}
    >
      <div className="space-y-2">
        {err && <div className="text-xs text-[var(--ac-stop)]">error: {err}</div>}
        {!rows && !err && <div className="text-xs text-white/40">loading…</div>}
        {rows?.length === 0 && (
          <div className="text-xs text-white/40">
            No standing watches — ask Ava to keep an eye on something.
          </div>
        )}
        {rows?.map((w) => (
          <WatchCard key={w.id} watch={w} onToggle={() => toggle(w)} onDelete={() => remove(w)} />
        ))}
      </div>
    </PanelSection>
  );
}

/**
 * One watch row: enabled toggle · prompt (truncated, tap to expand) · schedule
 * caption · last-check line (status glyph + result + relative time) · a two-tap
 * delete (first tap arms "sure?", second deletes; disarms itself after 2.5s).
 */
function WatchCard({ watch: w, onToggle, onDelete }: {
  watch: WatchRow;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const reduced = useReducedMotion();
  const { contextSafe } = useGSAP();
  const [expanded, setExpanded] = useState(false);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 2500);
    return () => window.clearTimeout(t);
  }, [armed]);

  const on = Boolean(w.enabled);
  const status = statusGlyph(w.last_status);

  return (
    <div
      className={
        "lg-slab lg-sweep relative flex items-start gap-3 rounded-xl px-4 py-3 text-xs " +
        (on ? "" : "opacity-60")
      }
      style={{ "--sweep-x": "-130%" } as CSSProperties}
      onMouseEnter={contextSafe((e: React.MouseEvent<HTMLDivElement>) => hoverLift(e.currentTarget, true, reduced))}
      onMouseLeave={contextSafe((e: React.MouseEvent<HTMLDivElement>) => hoverLift(e.currentTarget, false, reduced))}
    >
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="enabled"
        data-on={on ? "true" : "false"}
        onClick={onToggle}
        className="tgl mt-0.5 shrink-0"
      >
        <span className="tgl-knob" />
      </button>

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="block w-full text-left leading-relaxed text-white/85 transition-colors hover:text-white"
        >
          <span className={expanded ? "whitespace-pre-wrap break-words" : "block truncate"}>
            {String(w.prompt ?? "")}
          </span>
        </button>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 hud text-[9px] tracking-[0.16em] text-white/40">
          <span>{scheduleLabel(w)}</span>
          {w.kind === "reminder" && <span className="text-[var(--ac-exec)]/85">reminder</span>}
          {w.kind === "codex" && <span className="text-[var(--ac)]/85">Codex task</span>}
          {w.kind === "codex" && w.continue_cycle ? <span>continuous cycle</span> : null}
        </div>

        {w.last_run_at != null ? (
          <div className="mt-1.5 flex items-baseline gap-2 text-[11px] leading-relaxed">
            <span className={"shrink-0 " + status.cls} aria-label={`last check: ${status.label}`}>
              {status.glyph}
            </span>
            <span
              className={
                "min-w-0 flex-1 text-white/55 " +
                (expanded ? "whitespace-pre-wrap break-words" : "truncate")
              }
            >
              {w.last_result || "(no result)"}
            </span>
            <span className="hud shrink-0 text-[9px] tracking-[0.16em] text-white/35">
              {timeAgo(w.last_run_at)}
            </span>
          </div>
        ) : (
          <div className="mt-1.5 text-[11px] text-white/35">no checks yet</div>
        )}

        {w.kind === "codex" && w.continue_cycle && w.successor_status && (
          <div
            className={
              "mt-2 rounded-lg border px-2.5 py-2 text-[10px] leading-relaxed " +
              (w.successor_status === "blocked"
                ? "border-[var(--ac-stop)]/25 bg-[var(--ac-stop)]/[0.06] text-white/65"
                : w.successor_status === "scheduled"
                  ? "border-[var(--ac)]/20 bg-[var(--ac)]/[0.05] text-white/60"
                  : "border-[var(--ac-warn)]/20 bg-[var(--ac-warn)]/[0.05] text-white/60")
            }
            aria-label={`successor planning: ${w.successor_status}`}
          >
            <span className="hud mr-2 tracking-[0.14em] text-white/45">NEXT</span>
            {w.successor_result || w.successor_status}
            {w.successor_attempted_at ? ` · ${timeAgo(w.successor_attempted_at)}` : ""}
          </div>
        )}
      </div>

      <button
        type="button"
        aria-label={armed ? "confirm delete" : "delete"}
        onClick={() => {
          if (armed) { setArmed(false); onDelete(); }
          else setArmed(true);
        }}
        className={"btn-deck btn-danger shrink-0 !h-7 " + (armed ? "!px-2" : "!w-7 !px-0 justify-center")}
      >
        {armed ? <span className="hud text-[10px] tracking-[0.12em]">sure?</span> : <X size={14} aria-hidden />}
      </button>
    </div>
  );
}
