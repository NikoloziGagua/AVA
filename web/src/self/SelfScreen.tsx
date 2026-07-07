import { useRef, useState, type CSSProperties } from "react";
import { useSelfJournal, isRunningStatus, planText, type Intent } from "./useSelfJournal.js";
import { PanelShell, PanelSection } from "../components/ava/PanelShell.js";
import { useGSAP, gsap } from "../lib/gsap.js";
import { useReducedMotion } from "../lib/useReducedMotion.js";
import { hoverLift, press, settleText } from "../lib/deckMotion.js";

/** Status → left-spine accent + chip class. Cyan/live/exec/stop only as state, never decoration. */
function statusLook(status: string): { spine: string; chip: string } {
  if (isRunningStatus(status)) return { spine: "var(--ac-exec)", chip: "chip-exec" };
  if (status === "swapped") return { spine: "var(--ac-live)", chip: "chip-live" };
  if (status === "failed" || status === "cancelled") return { spine: "var(--ac-stop)", chip: "chip-stop" };
  if (status === "awaiting_approval") return { spine: "var(--ac)", chip: "chip-ac" };
  return { spine: "rgba(255,255,255,.18)", chip: "chip-ac" };
}

export function SelfScreen(_props: { onClose?: () => void }) {
  const { intents, paused, setPaused, improve, revertLast, cancel, approve, reject } =
    useSelfJournal();
  const canRevert = intents.some((i) => i.status === "swapped");
  const reduced = useReducedMotion();

  // Left-column summary — gives the short CONTROLS rail useful body so it isn't a
  // tall void beside the full-height Journal on desktop.
  const runningCount = intents.filter((i) => isRunningStatus(i.status)).length;
  const awaitingCount = intents.filter((i) => i.status === "awaiting_approval").length;
  const appliedCount = intents.filter((i) => i.status === "swapped").length;

  // Initiator: a user-written goal Ava should self-improve toward.
  const [goal, setGoal] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [improveError, setImproveError] = useState<string | null>(null);

  const onImprove = async (e: React.FormEvent) => {
    e.preventDefault();
    const g = goal.trim();
    if (!g || submitting) return;
    setSubmitting(true);
    setImproveError(null);
    const r = await improve(g);
    setSubmitting(false);
    if (r.ok) {
      setGoal(""); // the 4s poll surfaces the new intent in the journal
    } else {
      setImproveError(r.error ?? "couldn't start — try again");
    }
  };

  const scope = useRef<HTMLDivElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);

  const { contextSafe } = useGSAP(
    () => {
      // Settle the journal count (digits scramble).
      if (countRef.current) settleText(countRef.current, String(intents.length), reduced);

      // The ONLY idle loop on the whole deck: a soft pulse on the spine of every
      // running entry. Reduced-motion-gated — parks lit, no loop.
      if (reduced) return;
      const spines = scope.current?.querySelectorAll<HTMLElement>("[data-running-spine]");
      if (spines && spines.length) {
        gsap.to(spines, {
          opacity: 0.45,
          repeat: -1,
          yoyo: true,
          duration: 0.8,
          ease: "sine.inOut",
        });
      }
    },
    { scope, dependencies: [intents, reduced] },
  );

  const onEnter = contextSafe((e: React.PointerEvent<HTMLElement>) =>
    hoverLift(e.currentTarget, true, reduced),
  );
  const onLeave = contextSafe((e: React.PointerEvent<HTMLElement>) =>
    hoverLift(e.currentTarget, false, reduced),
  );
  const onDown = contextSafe((e: React.PointerEvent<HTMLElement>) =>
    press(e.currentTarget, true, reduced),
  );
  const onUp = contextSafe((e: React.PointerEvent<HTMLElement>) =>
    press(e.currentTarget, false, reduced),
  );

  return (
    <div ref={scope} className="h-full">
      <PanelShell title="Self-improvement" grid>
        <PanelSection
          title="Controls"
          span="lg:col-span-4"
          right={
            <span className={`chip ${paused ? "chip-stop" : "chip-live"}`}>
              {paused ? "PAUSED" : "ACTIVE"}
            </span>
          }
        >
          <div className="hud text-[11px] tracking-[0.18em] text-white/55">
            {paused ? "AUTONOMOUS · PAUSED" : "AUTONOMOUS · ACTIVE"}
          </div>
          <form aria-label="Start a self-improvement" onSubmit={onImprove} className="mt-4 flex gap-2">
            <input
              value={goal}
              onChange={(e) => {
                setGoal(e.target.value);
                if (improveError) setImproveError(null);
              }}
              placeholder="Tell Ava what to improve about herself…"
              aria-label="Improvement goal"
              className="h-9 min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.02] px-3 text-xs placeholder:text-white/35 focus:border-[rgba(92,242,255,0.4)] focus:outline-none transition-colors"
            />
            <button
              type="submit"
              disabled={submitting || !goal.trim()}
              onPointerDown={onDown}
              onPointerUp={onUp}
              onPointerLeave={onUp}
              className="btn-deck btn-primary h-9 shrink-0 px-3 text-[11px] disabled:opacity-40"
            >
              {submitting ? "Starting…" : "Improve"}
            </button>
          </form>
          {improveError && (
            <div role="alert" className="mt-2 text-xs text-[var(--ac-stop)]">
              {improveError}
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              onClick={() => setPaused(!paused)}
              aria-pressed={paused}
              onPointerDown={onDown}
              onPointerUp={onUp}
              onPointerLeave={onUp}
              className="btn-deck btn-primary flex-1"
            >
              {paused ? "Resume" : "Pause"}
            </button>
            <button
              onClick={revertLast}
              disabled={!canRevert}
              onPointerDown={onDown}
              onPointerUp={onUp}
              onPointerLeave={onUp}
              className="btn-deck btn-ghost flex-1 disabled:opacity-40"
            >
              Revert last
            </button>
          </div>
          <div className="text-[10px] text-white/40 mt-4 leading-relaxed">
            {paused
              ? "Paused — Ava won't act on self-improvements."
              : "Active — Ava may refine how it works for you."}
          </div>

          {/* Summary — fills the otherwise-empty lower half of the left rail. */}
          <div className="mt-6 border-t border-white/[0.07] pt-4">
            <div className="hud mb-3 text-[10px] tracking-[0.2em] text-white/40">SUMMARY</div>
            <div className="grid grid-cols-3 gap-2">
              <StatTile label="Total" value={intents.length} />
              <StatTile label="Running" value={runningCount} accent="var(--ac-exec)" />
              <StatTile label="Applied" value={appliedCount} accent="var(--ac-live)" />
            </div>
            {awaitingCount > 0 && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-[rgba(92,242,255,0.25)] bg-[rgba(92,242,255,0.05)] px-3 py-2">
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: "var(--ac)", boxShadow: "0 0 6px rgba(92,242,255,.8)" }}
                />
                <span className="text-[11px] text-white/70">
                  {awaitingCount} awaiting your approval
                </span>
              </div>
            )}
          </div>
        </PanelSection>

        <PanelSection
          title="Journal"
          span="lg:col-span-8"
          right={
            <span className="flex items-center gap-2">
              {paused && <span className="chip chip-stop">PAUSED</span>}
              <span className="chip chip-ac">
                <span ref={countRef}>{intents.length}</span>
              </span>
            </span>
          }
        >
          {intents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="hud text-[11px] tracking-[0.22em] text-white/35">
                NO SELF-IMPROVEMENTS YET
              </div>
            </div>
          ) : (
            <ul className="space-y-3">
              {intents.map((i) => (
                <JournalEntry
                  key={i.id}
                  intent={i}
                  reduced={reduced}
                  onEnter={onEnter}
                  onLeave={onLeave}
                  onDown={onDown}
                  onUp={onUp}
                  cancel={cancel}
                  approve={approve}
                  reject={reject}
                />
              ))}
            </ul>
          )}
        </PanelSection>
      </PanelShell>
    </div>
  );
}

/** A compact metric cell for the Controls summary rail. */
function StatTile({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2.5 text-center">
      <div
        className="text-lg font-semibold tabular-nums leading-none"
        style={{ color: accent ?? "rgba(255,255,255,0.9)" }}
      >
        {value}
      </div>
      <div className="hud mt-1.5 text-[9px] tracking-[0.14em] text-white/40">{label}</div>
    </div>
  );
}

function JournalEntry({
  intent: i,
  reduced,
  onEnter,
  onLeave,
  onDown,
  onUp,
  cancel,
  approve,
  reject,
}: {
  intent: Intent;
  reduced: boolean;
  onEnter: (e: React.PointerEvent<HTMLElement>) => void;
  onLeave: (e: React.PointerEvent<HTMLElement>) => void;
  onDown: (e: React.PointerEvent<HTMLElement>) => void;
  onUp: (e: React.PointerEvent<HTMLElement>) => void;
  cancel: (id: string) => void;
  approve: (id: string) => void;
  reject: (id: string) => void;
}) {
  const running = isRunningStatus(i.status);
  const look = statusLook(i.status);

  return (
    <li
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      className="lg-slab lg-sweep relative overflow-hidden rounded-xl pl-5 pr-4 py-3.5"
      style={{ "--sweep-x": "-130%" } as CSSProperties}
    >
      {/* Left status spine */}
      <span
        aria-hidden
        {...(running ? { "data-running-spine": "" } : {})}
        className="pointer-events-none absolute left-0 top-2 bottom-2 w-[3px] rounded-full"
        style={{ background: look.spine, boxShadow: `0 0 8px -1px ${look.spine}` }}
      />

      <div className="flex items-start justify-between gap-3">
        <div className="text-sm text-white/90 leading-snug">{i.goal}</div>
        {running && (
          <button
            onClick={() => cancel(i.id)}
            onPointerDown={onDown}
            onPointerUp={onUp}
            onPointerLeave={onUp}
            className="btn-deck btn-danger shrink-0 h-7 px-3 text-[11px]"
          >
            Stop
          </button>
        )}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <span className={`chip ${look.chip}`}>
          {i.status === "awaiting_approval" ? "awaiting your approval" : i.status}
        </span>
        {i.outcome ? (
          <span className="hud text-[10px] tracking-[0.16em] text-white/40">· {i.outcome}</span>
        ) : null}
      </div>

      {i.status === "awaiting_approval" && (
        <div className="lg-slab lg-rim-mercury mt-3 rounded-xl px-4 py-3">
          <div className="hud mb-2 flex items-center gap-2 text-[10px] tracking-[0.18em] text-white/55">
            <span
              className="h-1 w-1 rounded-full"
              style={{ background: "var(--ac)", boxShadow: "0 0 6px rgba(92,242,255,.8)" }}
            />
            PLAN — REVIEW BEFORE IT RUNS
          </div>
          <div className="relative pl-3">
            <span
              aria-hidden
              className="lg-edgelight pointer-events-none absolute left-0 top-1 bottom-1 w-px"
            />
            <pre className="no-scrollbar max-h-56 overflow-y-auto whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-white/80">
              {planText(i.diff_summary) || "(no plan text)"}
            </pre>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => approve(i.id)}
              onPointerDown={onDown}
              onPointerUp={onUp}
              onPointerLeave={onUp}
              className="btn-deck btn-primary"
            >
              Approve & run
            </button>
            <button
              onClick={() => reject(i.id)}
              onPointerDown={onDown}
              onPointerUp={onUp}
              onPointerLeave={onUp}
              className="btn-deck btn-danger"
            >
              Reject
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
