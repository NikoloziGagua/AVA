import { nanoid } from "nanoid";
import type { AgentEvent } from "../orchestrator/agent.js";
import type { ObservabilityService } from "./store.js";

type ToolOperation = {
  spanId: string;
  actionId: string;
  startedAt: number;
};

/**
 * Bridges AVA's existing agent event grammar into Mission Control. It preserves
 * one executor-owned action id across tool start/result and deliberately omits
 * thought/delta events: operational summaries are observable; hidden reasoning
 * and token-by-token prose are not.
 */
export class AgentObservabilityRecorder {
  private toolSequence = 0;
  private activeTools = new Map<string, ToolOperation[]>();

  constructor(
    private readonly observability: ObservabilityService,
    private readonly runId: string,
    private readonly parentSpanId: string | null = null,
    private readonly causationEventId: string | null = null,
  ) {}

  record(event: AgentEvent, options: { at?: number; durationMs?: number | null } = {}): void {
    const at = options.at ?? Date.now();
    if (event.kind === "thought" || event.kind === "delta") return;

    switch (event.kind) {
      case "tool_call": {
        const operation: ToolOperation = {
          spanId: `span_tool_${nanoid(12)}`,
          actionId: `${this.runId}:tool:${++this.toolSequence}`,
          startedAt: at,
        };
        const queue = this.activeTools.get(event.payload.tool) ?? [];
        queue.push(operation);
        this.activeTools.set(event.payload.tool, queue);
        this.observability.record(this.runId, {
          spanId: operation.spanId,
          parentSpanId: this.parentSpanId,
          causationEventId: this.causationEventId,
          type: "tool.call.started",
          status: "running",
          title: `Started ${event.payload.tool}`,
          summary: `AVA dispatched ${event.payload.tool}.`,
          visibility: "detail",
          payload: { tool: event.payload.tool, args: event.payload.args },
          actionId: operation.actionId,
          actionOwner: "executor",
          occurredAt: at,
        });
        return;
      }
      case "tool_result": {
        const queue = this.activeTools.get(event.payload.tool) ?? [];
        const operation = queue.shift() ?? {
          spanId: `span_tool_${nanoid(12)}`,
          actionId: `${this.runId}:tool:unpaired:${++this.toolSequence}`,
          startedAt: at,
        };
        if (queue.length === 0) this.activeTools.delete(event.payload.tool);
        else this.activeTools.set(event.payload.tool, queue);
        this.observability.record(this.runId, {
          spanId: operation.spanId,
          parentSpanId: this.parentSpanId,
          causationEventId: this.causationEventId,
          type: "tool.call.completed",
          status: event.payload.ok ? "success" : "error",
          title: `${event.payload.tool} ${event.payload.ok ? "completed" : "failed"}`,
          summary: event.payload.ok
            ? "The tool returned successfully; this is not automatically independent verification."
            : "The tool returned an error.",
          visibility: "detail",
          payload: { tool: event.payload.tool, result: event.payload.result },
          error: event.payload.ok ? null : event.payload.result,
          actionId: operation.actionId,
          actionOwner: "executor",
          durationMs: options.durationMs ?? Math.max(0, at - operation.startedAt),
          occurredAt: at,
          terminal: true,
        });
        return;
      }
      case "approval_required":
        this.observability.record(this.runId, {
          parentSpanId: this.parentSpanId,
          causationEventId: this.causationEventId,
          type: "approval.requested",
          status: "waiting",
          title: `Approval required for ${event.payload.tool}`,
          summary: event.payload.summary,
          // Never copy tool args into the observability event. The approval
          // summary is the intentional, already-redacted disclosure boundary.
          payload: {
            approvalId: event.payload.id,
            tool: event.payload.tool,
            summary: event.payload.summary,
          },
          occurredAt: at,
          runStatus: "waiting_for_approval",
        });
        return;
      case "approval_resolved":
        this.observability.record(this.runId, {
          parentSpanId: this.parentSpanId,
          causationEventId: this.causationEventId,
          type: "approval.resolved",
          status: event.payload.status,
          title: `Approval ${event.payload.status}`,
          payload: { approvalId: event.payload.id },
          occurredAt: at,
          runStatus: "running",
        });
        return;
      case "final":
        this.observability.record(this.runId, {
          parentSpanId: this.parentSpanId,
          causationEventId: this.causationEventId,
          type: "agent.response.completed",
          status: "success",
          title: "AVA returned a final response",
          summary: "A final response was recorded; the requested external outcome remains unverified unless evidence says otherwise.",
          visibility: "sensitive_collapsed",
          payload: { response: event.payload.text },
          occurredAt: at,
          terminal: true,
          runStatus: "completed",
          outcome: "result_returned_unverified",
          verificationStatus: "not_recorded",
          compactSummary: "AVA returned a final response. External effects require separate verification evidence.",
        });
        return;
      case "error":
        this.observability.record(this.runId, {
          parentSpanId: this.parentSpanId,
          causationEventId: this.causationEventId,
          type: "agent.run.failed",
          status: "error",
          title: "AVA agent failed",
          error: event.payload.message,
          occurredAt: at,
          terminal: true,
          runStatus: "failed",
          outcome: "failed_safely",
          verificationStatus: "not_verified",
          compactSummary: event.payload.message,
        });
        return;
      case "killed": {
        const reason = event.payload.reason ?? "manual";
        this.observability.record(this.runId, {
          parentSpanId: this.parentSpanId,
          causationEventId: this.causationEventId,
          type: "agent.run.cancelled",
          status: "cancelled",
          title: reason === "manual" ? "Agent run cancelled by Niko" : "AVA stopped the agent run",
          payload: { reason },
          occurredAt: at,
          terminal: true,
          runStatus: "cancelled",
          outcome: reason === "manual" ? "cancelled_by_user" : `halted_by_${reason}`,
          verificationStatus: "not_verified",
        });
        return;
      }
      case "done":
        this.observability.record(this.runId, {
          parentSpanId: this.parentSpanId,
          causationEventId: this.causationEventId,
          type: "agent.runtime.finished",
          status: "success",
          title: "Agent runtime finished",
          occurredAt: at,
        });
        return;
    }
  }
}
