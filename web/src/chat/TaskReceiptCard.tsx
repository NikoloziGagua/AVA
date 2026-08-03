import { Activity, CheckCircle2, ChevronDown, CircleAlert, Clock3, ShieldQuestion } from "lucide-react";
import {
  RECEIPT_LIFECYCLE_LABEL,
  RECEIPT_OUTCOME_LABEL,
  type TaskReceipt,
  type TaskReceiptOutcome,
} from "./task-receipt.js";

const OUTCOME_STYLE: Record<TaskReceiptOutcome, { color: string; surface: string; border: string; Icon: typeof CheckCircle2 }> = {
  verified: {
    color: "rgb(110 231 183)",
    surface: "rgba(52,211,153,0.08)",
    border: "rgba(110,231,183,0.30)",
    Icon: CheckCircle2,
  },
  partial: {
    color: "rgb(251 191 36)",
    surface: "rgba(245,158,11,0.10)",
    border: "rgba(251,191,36,0.34)",
    Icon: CircleAlert,
  },
  unverified: {
    color: "rgb(125 211 252)",
    surface: "rgba(56,189,248,0.08)",
    border: "rgba(125,211,252,0.30)",
    Icon: ShieldQuestion,
  },
  failed: {
    color: "rgb(252 165 165)",
    surface: "rgba(239,68,68,0.10)",
    border: "rgba(252,165,165,0.34)",
    Icon: CircleAlert,
  },
};

export function TaskReceiptCard({ receipt }: { receipt: TaskReceipt }) {
  const style = OUTCOME_STYLE[receipt.outcome];
  const Icon = style.Icon;
  const concerning = receipt.outcome !== "verified" || receipt.lifecycle !== "finished";

  return (
    <div className="flex justify-start" data-testid="task-receipt">
      <details
        className="group/receipt ml-9 w-[min(92%,680px)] overflow-hidden rounded-2xl"
        style={{
          border: `1px solid ${concerning ? style.border : "rgba(255,255,255,0.10)"}`,
          background: `linear-gradient(145deg, ${style.surface}, rgba(8,12,18,0.82))`,
          boxShadow: "0 16px 50px -28px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,255,255,0.06)",
        }}
      >
        <summary className="list-none cursor-pointer px-4 py-3.5 marker:content-none">
          <div className="flex items-start gap-3">
            <div
              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
              style={{ color: style.color, background: style.surface }}
            >
              <Icon size={16} strokeWidth={1.9} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="hud text-[9px] uppercase tracking-[0.18em] text-white/45">Task receipt</span>
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                  style={{ color: style.color, background: style.surface }}
                >
                  {RECEIPT_OUTCOME_LABEL[receipt.outcome]}
                </span>
                <span className="text-[10px] text-white/35">{RECEIPT_LIFECYCLE_LABEL[receipt.lifecycle]}</span>
              </div>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/78">{receipt.actual}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-white/44">
                <span className="text-white/62">Last proven:</span> {receipt.lastVerifiedStage}
              </p>
              {concerning && receipt.observationPoint && (
                <p className="mt-1 text-[11px] leading-relaxed" style={{ color: style.color }}>
                  Evidence changed here: {receipt.observationPoint}
                </p>
              )}
            </div>
            <ChevronDown
              size={15}
              className="mt-2 shrink-0 text-white/35 transition-transform duration-200 group-open/receipt:rotate-180"
            />
          </div>
        </summary>

        <div className="border-t border-white/[0.07] px-4 pb-4 pt-3.5">
          <div className="grid gap-3 sm:grid-cols-2">
            <DiagnosticField label="Expected" value={receipt.expected} />
            <DiagnosticField label="Actually observed" value={receipt.actual} />
            <DiagnosticField label="Last proven stage" value={receipt.lastVerifiedStage} />
            <DiagnosticField
              label="Failure / uncertainty boundary"
              value={receipt.observationPoint ?? "No failure or uncertainty boundary was observed."}
            />
          </div>

          <div className="mt-4">
            <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-white/40">
              <Activity size={12} /> Evidence trail
            </div>
            <div className="space-y-2">
              {receipt.evidence.map((item, index) => (
                <div key={`${item.kind}-${index}`} className="flex gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-2.5">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300/60" />
                  <div className="min-w-0">
                    <div className="text-[11px] text-white/72">{item.label}</div>
                    <div className="mt-0.5 text-[10.5px] leading-relaxed text-white/38">{item.detail}</div>
                    <div className="mt-1 text-[9px] uppercase tracking-[0.12em] text-white/25">{item.strength}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {receipt.recoveryAction && (
            <div className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.035] px-3 py-2.5">
              <div className="text-[9px] uppercase tracking-[0.16em] text-white/35">Recommended next action</div>
              <div className="mt-1 text-[11.5px] leading-relaxed text-white/72">{receipt.recoveryAction}</div>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[9.5px] text-white/30">
            <span className="inline-flex items-center gap-1"><Clock3 size={11} /> {formatDuration(receipt.durationMs)}</span>
            <span>Root cause: {receipt.rootCause.replaceAll("_", " ")}</span>
            <span>Tools: {receipt.successfulToolResults} ok · {receipt.uncertainToolResults} uncertain · {receipt.failedToolResults} failed</span>
            <span className="font-mono">ID {receipt.taskId}</span>
          </div>
        </div>
      </details>
    </div>
  );
}

function DiagnosticField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-[0.16em] text-white/32">{label}</div>
      <div className="mt-1 text-[11px] leading-relaxed text-white/66">{value}</div>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.max(0, Math.round(ms))}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1_000);
  return `${minutes}m ${seconds}s`;
}
