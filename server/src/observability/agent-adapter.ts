import { nanoid } from "nanoid";
import type { AgentEvent } from "../orchestrator/agent.js";
import type { ProviderUsage } from "../orchestrator/llm/types.js";
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
  private finalResponseRecorded = false;
  private terminalRecorded = false;
  private taskOutcomeVerifiedSeen = false;
  private operationVerifiedSeen = false;
  private contradictionSeen = false;
  private toolFailureSeen = false;
  private verificationStatus: "verified" | "partially_verified" | "not_verified" | "not_recorded" = "not_recorded";
  private verificationOutcome: string | null = null;

  constructor(
    private readonly observability: ObservabilityService,
    private readonly runId: string,
    private readonly parentSpanId: string | null = null,
    private readonly causationEventId: string | null = null,
  ) {}

  recordUsage(usage: ProviderUsage, options: { at?: number } = {}): void {
    const at = options.at ?? Date.now();
    this.observability.record(this.runId, {
      parentSpanId: this.parentSpanId,
      causationEventId: this.causationEventId,
      type: "provider.usage.recorded",
      status: "success",
      title: `Usage reported by ${usage.model}`,
      summary: `${usage.inputTokens} input and ${usage.outputTokens} output tokens were reported by the provider.`,
      visibility: "detail",
      payload: { model: usage.model },
      providerRequestId: usage.providerRequestId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedTokens: usage.cachedTokens,
      occurredAt: at,
      dedupKey: usage.providerRequestId
        ? `${this.runId}:provider-usage:${usage.providerRequestId}`
        : `${this.runId}:provider-usage:${at}`,
    });
  }

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
        if (!event.payload.ok) this.toolFailureSeen = true;
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
        if (event.payload.verification) {
          const evidence = event.payload.verification;
          if (evidence.state === "verified") {
            if (evidence.scope === "task_outcome") this.taskOutcomeVerifiedSeen = true;
            else this.operationVerifiedSeen = true;
          } else if (evidence.state === "contradicted") {
            this.contradictionSeen = true;
          }
          this.observability.record(this.runId, {
            spanId: operation.spanId,
            parentSpanId: this.parentSpanId,
            causationEventId: this.causationEventId,
            type: "verification.evidence.recorded",
            status: evidence.state === "verified"
              ? "success"
              : evidence.state === "contradicted" ? "error" : "observed",
            title: `${event.payload.tool} verification ${evidence.state}`,
            summary: evidence.summary,
            visibility: "sensitive_collapsed",
            payload: {
              tool: event.payload.tool,
              state: evidence.state,
              scope: evidence.scope,
              method: evidence.method,
              evidenceRef: evidence.evidenceRef ?? null,
              observedAt: evidence.observedAt ?? at,
            },
            occurredAt: evidence.observedAt ?? at,
            dedupKey: `${operation.actionId}:verification:${evidence.method}:${evidence.state}`,
          });
        }
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
        if (this.terminalRecorded || this.finalResponseRecorded) return;
        this.finalResponseRecorded = true;
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
        });
        return;
      case "error":
        if (this.terminalRecorded) return;
        this.terminalRecorded = true;
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
        if (this.terminalRecorded) return;
        this.terminalRecorded = true;
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
      case "done": {
        if (this.terminalRecorded) return;
        this.terminalRecorded = true;
        const completed = this.finalResponseRecorded;
        if (this.contradictionSeen) {
          this.verificationStatus = "not_verified";
          this.verificationOutcome = "executor_result_contradicted";
        } else if (this.taskOutcomeVerifiedSeen && !this.toolFailureSeen) {
          this.verificationStatus = "verified";
          this.verificationOutcome = "verified_by_tool_evidence";
        } else if (this.taskOutcomeVerifiedSeen || this.operationVerifiedSeen) {
          this.verificationStatus = "partially_verified";
          this.verificationOutcome = this.toolFailureSeen
            ? "partial_with_tool_failure"
            : "operation_verified_only";
        }
        this.observability.record(this.runId, {
          parentSpanId: this.parentSpanId,
          causationEventId: this.causationEventId,
          type: "agent.runtime.finished",
          status: completed ? "success" : "error",
          title: completed ? "Agent runtime finished" : "Agent runtime ended without a final response",
          summary: completed
            ? this.verificationOutcome === "executor_result_contradicted"
              ? "AVA returned a final response, but verification contradicted an executor result."
              : this.verificationStatus === "verified"
              ? "AVA returned a final response backed by task-outcome verification evidence."
              : this.verificationStatus === "partially_verified"
                ? "AVA returned a final response with operation-level evidence only."
                : "AVA returned a final response. External effects require separate verification evidence."
            : "The runtime stopped without recording a user-facing final response.",
          occurredAt: at,
          terminal: true,
          runStatus: completed ? "completed" : "failed",
          outcome: completed
            ? (this.verificationOutcome ?? "result_returned_unverified")
            : "runtime_ended_without_final",
          verificationStatus: completed ? this.verificationStatus : "not_verified",
          compactSummary: completed
            ? this.verificationOutcome === "executor_result_contradicted"
              ? "AVA returned a final response, but verification contradicted an executor result."
              : this.verificationStatus === "verified"
              ? "AVA returned a final response backed by task-outcome verification evidence."
              : this.verificationStatus === "partially_verified"
                ? "AVA returned a final response with operation-level evidence only."
                : "AVA returned a final response. External effects require separate verification evidence."
            : "The agent runtime ended without a final response.",
        });
        return;
      }
    }
  }
}
