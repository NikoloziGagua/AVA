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
}

export function deriveSteps(events: StreamEvent[]): ActivityStep[] {
  const steps: ActivityStep[] = [];
  // tool name → index of its most recent still-running step.
  const running = new Map<string, number>();
  for (const e of events) {
    if (e.kind === "tool_call") {
      steps.push({ key: `c-${e.id}`, label: humanizeTool(e.payload.tool, e.payload.args), status: "running" });
      running.set(e.payload.tool, steps.length - 1);
    } else if (e.kind === "tool_result") {
      const idx = running.get(e.payload.tool);
      if (idx != null && steps[idx]) {
        steps[idx].status = "done";
        steps[idx].ok = e.payload.ok;
        running.delete(e.payload.tool);
      } else {
        steps.push({ key: `r-${e.id}`, label: humanizeTool(e.payload.tool), status: "done", ok: e.payload.ok });
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
