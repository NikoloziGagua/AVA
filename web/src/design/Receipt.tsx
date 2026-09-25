import type { ReactNode } from "react";
import { cn } from "./cn.js";
import { Tag, type Tone } from "./Indicators.js";

/**
 * Proof that AVA did something: what happened, the evidence, and what you can
 * do next. One family for task receipts, saved items, room posts, memory
 * context and tool calls. A status tag always spells the state out in words.
 */
export function Receipt({ icon, title, detail, status, statusTone = "neutral", proof, action, className }: {
  icon?: ReactNode;
  title: string;
  detail?: ReactNode;
  status?: string;
  statusTone?: Tone;
  /** Small verifiable references, e.g. "#512", a file name or a time. */
  proof?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start gap-3 rounded-card bg-surface px-4 py-3 shadow-e1", className)}>
      {icon && <span aria-hidden="true" className="mt-0.5 shrink-0 text-ink-2">{icon}</span>}
      <div className="grid min-w-0 flex-1 gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-body font-medium text-ink">{title}</span>
          {status && <Tag tone={statusTone}>{status}</Tag>}
        </div>
        {detail && <div className="text-meta text-ink-2">{detail}</div>}
        {proof && <div className="font-ui-mono text-label text-ink-3">{proof}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** Long-form text (AVA's answers, note pages) on the new type scale. */
export function Prose({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("ds-prose", className)}>{children}</div>;
}
