// Derive the Activity panel's step list from the live SSE event stream. A
// tool_call starts a "running" step; the matching tool_result completes it.
// Pure + tested so the panel and the working-mode trigger share one source.
import type { StreamEvent } from "./useChatStream.js";
import { humanizeTool } from "./humanize.js";

export interface ActivityStep {
  key: string;
  label: string;
  status: "done" | "running" | "queued";
  ok?: boolean;
  /** Short single-line failure reason (only when ok === false), for inline display. */
  reason?: string;
  /** Fuller failure reason (only when ok === false), for the row's title tooltip. */
  reasonFull?: string;
}

const REASON_CHARS = 90;
const REASON_TITLE_CHARS = 300;

/** Collapse to one whitespace-normalized line, capped at n chars (… when cut). */
function oneLine(v: unknown, n: number): string {
  const t = String(v).trim().replace(/\s+/g, " ");
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

function attachFailureReason(step: ActivityStep, result: unknown): void {
  const reason = oneLine(result, REASON_CHARS);
  if (!reason) return;
  step.reason = reason;
  step.reasonFull = oneLine(result, REASON_TITLE_CHARS);
}

export function deriveSteps(events: StreamEvent[]): ActivityStep[] {
  const steps: ActivityStep[] = [];
  // tool name → FIFO queue of indices of its still-running steps, so two
  // overlapping calls to the same tool complete in call order.
  const running = new Map<string, number[]>();
  for (const e of events) {
    if (e.kind === "tool_call") {
      steps.push({ key: `c-${e.id}`, label: humanizeTool(e.payload.tool, e.payload.args), status: "running" });
      const queue = running.get(e.payload.tool);
      if (queue) queue.push(steps.length - 1);
      else running.set(e.payload.tool, [steps.length - 1]);
    } else if (e.kind === "tool_result") {
      const idx = running.get(e.payload.tool)?.shift();
      const step = idx != null ? steps[idx] : undefined;
      if (step) {
        step.status = "done";
        step.ok = e.payload.ok;
        if (e.payload.ok === false) attachFailureReason(step, e.payload.result);
      } else {
        const orphan: ActivityStep = { key: `r-${e.id}`, label: humanizeTool(e.payload.tool), status: "done", ok: e.payload.ok };
        if (e.payload.ok === false) attachFailureReason(orphan, e.payload.result);
        steps.push(orphan);
      }
    }
  }
  return steps;
}

/** True while any tool call is still in flight — drives the charged "working" UI. */
export function isExecuting(events: StreamEvent[]): boolean {
  return deriveSteps(events).some((s) => s.status === "running");
}

/** Label of the tool currently running (for the header), or null. */
export function currentTool(events: StreamEvent[]): string | null {
  const running = deriveSteps(events).filter((s) => s.status === "running");
  return running.length ? running[running.length - 1]!.label : null;
}
