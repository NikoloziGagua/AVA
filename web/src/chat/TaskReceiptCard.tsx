import { Activity, CheckCircle2, ChevronDown, CircleAlert, Clock3, ShieldQuestion } from "lucide-react";
import { cn } from "../design/cn.js";
import {
  RECEIPT_LIFECYCLE_LABEL,
  RECEIPT_OUTCOME_LABEL,
  type TaskReceipt,
  type TaskReceiptOutcome,
} from "./task-receipt.js";

// Each outcome keeps its own honest colour; only "verified" reads as good news.
const OUTCOME_STYLE: Record<TaskReceiptOutcome, { tone: string; soft: string; Icon: typeof CheckCircle2 }> = {
  verified: { tone: "text-success", soft: "bg-success-soft", Icon: CheckCircle2 },
  partial: { tone: "text-warning", soft: "bg-warning-soft", Icon: CircleAlert },
  unverified: { tone: "text-info", soft: "bg-info-soft", Icon: ShieldQuestion },
  contradicted: { tone: "text-warning", soft: "bg-warning-soft", Icon: CircleAlert },
  failed: { tone: "text-danger", soft: "bg-danger-soft", Icon: CircleAlert },
};

const LABEL = "font-ui-mono text-label uppercase text-ink-3";

/** What AVA actually did for a task, what was proven, and where the proof stops. */
export function TaskReceiptCard({ receipt }: { receipt: TaskReceipt }) {
  const style = OUTCOME_STYLE[receipt.outcome];
  const Icon = style.Icon;
  const concerning = receipt.outcome !== "verified" || receipt.lifecycle !== "finished";
  const outcomeLabel = receipt.outcome === "unverified" && receipt.verificationScope === "response_delivery"
    ? "Response delivered"
    : RECEIPT_OUTCOME_LABEL[receipt.outcome];

  return (
    <div className="flex justify-start" data-testid="task-receipt">
      <details className={cn("group/receipt w-full overflow-hidden rounded-card shadow-e1", concerning ? style.soft : "bg-surface")}>
        <summary className="ds-focus flex cursor-pointer list-none items-start gap-3 rounded-card px-4 py-3.5 [&::-webkit-details-marker]:hidden">
          <span className={cn("mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-glass", style.tone)}>
            <Icon size={18} aria-hidden="true" />
          </span>
          <span className="grid min-w-0 flex-1 gap-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className={LABEL}>Task receipt</span>
              <span className={cn("rounded-full bg-glass px-2.5 py-0.5 text-label font-medium", style.tone)}>{outcomeLabel}</span>
              <span className="text-label text-ink-3">{RECEIPT_LIFECYCLE_LABEL[receipt.lifecycle]}</span>
            </span>
            <span className="text-body text-ink">{receipt.actual}</span>
            <span className="text-meta text-ink-2">
              <span className="text-ink">Last proven:</span> {receipt.lastVerifiedStage}
            </span>
            {concerning && receipt.observationPoint && (
              <span className={cn("text-meta", style.tone)}>Evidence changed here: {receipt.observationPoint}</span>
            )}
          </span>
          <ChevronDown size={17} aria-hidden="true" className="mt-2 shrink-0 text-ink-3 transition-transform duration-200 group-open/receipt:rotate-180" />
        </summary>

        <div className="grid gap-4 px-4 pb-4 pt-1">
          <div className="grid gap-3 sm:grid-cols-2">
            <DiagnosticField label="Expected" value={receipt.expected} />
            <DiagnosticField label="Actually observed" value={receipt.actual} />
            <DiagnosticField label="Last proven stage" value={receipt.lastVerifiedStage} />
            <DiagnosticField
              label="Failure / uncertainty boundary"
              value={receipt.observationPoint ?? "No failure or uncertainty boundary was observed."}
            />
          </div>

          <div className="grid gap-2">
            <div className={cn("flex items-center gap-2", LABEL)}>
              <Activity size={14} aria-hidden="true" /> Evidence trail
            </div>
            <ul className="grid gap-2">
              {receipt.evidence.map((item, index) => (
                <li key={`${item.kind}-${index}`} className="grid gap-1 rounded-control bg-glass px-3 py-2.5">
                  <span className="text-meta text-ink">{item.label}</span>
                  <span className="text-meta text-ink-2">{item.detail}</span>
                  <span className={LABEL}>{item.strength}</span>
                  {item.method && <span className="font-ui-mono text-label text-ink-3">method: {item.method}</span>}
                </li>
              ))}
            </ul>
          </div>

          {receipt.recoveryAction && (
            <div className="grid gap-1 rounded-control bg-glass px-3 py-2.5">
              <span className={LABEL}>Recommended next action</span>
              <span className="text-meta text-ink">{receipt.recoveryAction}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-label text-ink-3">
            <span className="inline-flex items-center gap-1"><Clock3 size={13} aria-hidden="true" /> {formatDuration(receipt.durationMs)}</span>
            <span>Root cause: {receipt.rootCause.replaceAll("_", " ")}</span>
            <span>Tools: {receipt.successfulToolResults} ok · {receipt.uncertainToolResults} uncertain · {receipt.failedToolResults} failed</span>
            <span className="font-ui-mono">ID {receipt.taskId}</span>
          </div>
        </div>
      </details>
    </div>
  );
}

function DiagnosticField({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <div className={LABEL}>{label}</div>
      <div className="text-meta text-ink-2">{value}</div>
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
