import { useId, useState } from "react";
import { ChevronDown, ChevronRight, CircleAlert, CircleCheck } from "lucide-react";
import { cn } from "../design/cn.js";

export interface ToolCallChipProps {
  /** Humanized, present-tense action, e.g. "Running git status". */
  label: string;
  /** Raw tool output — tucked behind a click, never shown by default. */
  result?: string;
  ok?: boolean;
}

/**
 * One action AVA took, in words. The raw tool output (stdout, exit codes, JSON)
 * stays behind a click so the conversation stays readable; the conversation
 * shows these inline only when something failed.
 */
export function ToolCallChip({ label, result, ok }: ToolCallChipProps) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const failed = ok === false;
  const hasDetail = Boolean(result);
  const Icon = failed ? CircleAlert : CircleCheck;
  return (
    <div className="grid gap-1.5">
      <button
        type="button"
        onClick={hasDetail ? () => setOpen((value) => !value) : undefined}
        aria-expanded={hasDetail ? open : undefined}
        aria-controls={hasDetail ? detailId : undefined}
        className={cn(
          "ds-focus inline-flex w-fit max-w-full items-center gap-2 rounded-full px-3 py-1.5 text-meta",
          failed ? "bg-danger-soft text-danger" : "bg-glass text-ink-2",
          !hasDetail && "cursor-default",
        )}
      >
        <Icon size={14} aria-hidden="true" className="shrink-0" />
        <span className="min-w-0 truncate">{failed ? `${label} failed` : label}</span>
        {hasDetail && (open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />)}
      </button>
      {open && hasDetail && (
        <pre id={detailId} className="max-h-40 max-w-full overflow-auto whitespace-pre-wrap rounded-control bg-surface p-3 font-ui-mono text-label text-ink-2">
          {failed ? "ERROR: " : ""}{result}
        </pre>
      )}
    </div>
  );
}
