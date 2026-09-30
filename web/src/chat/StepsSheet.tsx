import { Circle, CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import { Sheet } from "../design/Sheet.js";
import { cn } from "../design/cn.js";
import type { ActivityStep } from "./activity-steps.js";

function StepIcon({ step }: { step: ActivityStep }) {
  if (step.status === "running") return <LoaderCircle size={16} aria-hidden="true" className="animate-spin text-ink" />;
  if (step.status === "queued") return <Circle size={16} aria-hidden="true" className="text-ink-3" />;
  if (step.ok === false) return <CircleAlert size={16} aria-hidden="true" className="text-danger" />;
  return <CircleCheck size={16} aria-hidden="true" className="text-success" />;
}

const STATUS_WORD: Record<ActivityStep["status"], string> = { running: "running", queued: "waiting", done: "done" };

/**
 * Everything AVA did for this reply, in order (contract ui-remodel v2 §7: tool
 * activity folds into the island and receipts). Opened from the island.
 */
export function StepsSheet({ open, onOpenChange, steps, executing }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  steps: readonly ActivityStep[];
  executing: boolean;
}) {
  const done = steps.filter((step) => step.status === "done").length;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="What AVA did"
      description={executing ? `Working · ${done} of ${steps.length} steps done` : `${steps.length} step${steps.length === 1 ? "" : "s"} for this reply`}
    >
      {steps.length === 0 ? (
        <p className="text-body text-ink-2">No steps yet.</p>
      ) : (
        <ol className="grid gap-1">
          {steps.map((step) => {
            const failed = step.status === "done" && step.ok === false;
            return (
              <li
                key={step.key}
                className={cn("flex items-start gap-3 rounded-button px-3 py-2.5", step.status === "running" && "bg-glass")}
                title={failed ? step.reasonFull ?? step.reason : undefined}
              >
                <span className="mt-0.5 shrink-0"><StepIcon step={step} /></span>
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className={cn("text-body", step.status === "running" ? "text-ink" : "text-ink-2")}>{step.label}</span>
                  {failed && step.reason && <span className="text-meta text-danger">{step.reason}</span>}
                </span>
                <span className="sr-only">{failed ? "failed" : STATUS_WORD[step.status]}</span>
              </li>
            );
          })}
        </ol>
      )}
    </Sheet>
  );
}
