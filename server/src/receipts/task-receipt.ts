import type { AgentEvent } from "../orchestrator/agent.js";
import { classifyActionResult, type ActionResultClass } from "../orchestrator/tool-result-consistency.js";
import { scrubSecrets } from "../security/scrub.js";

export const TASK_RECEIPT_SCHEMA_VERSION = 1 as const;

export type TaskReceiptLifecycle =
  | "running"
  | "awaiting_approval"
  | "finished"
  | "blocked"
  | "cancelled"
  | "failed";

export type TaskReceiptOutcome = "verified" | "partial" | "unverified" | "failed";
export type TaskReceiptRootCause = "known" | "likely" | "unknown" | "not_applicable";

export type TaskReceiptEvidence = {
  kind: "request" | "approval" | "tool_result" | "response" | "runtime";
  label: string;
  detail: string;
  strength: "verified" | "observed" | "reported";
};

export type TaskReceipt = {
  schemaVersion: typeof TASK_RECEIPT_SCHEMA_VERSION;
  taskId: string;
  expected: string;
  actual: string;
  lifecycle: TaskReceiptLifecycle;
  outcome: TaskReceiptOutcome;
  verificationScope: "response_delivery" | "operational_steps" | "none";
  lastVerifiedStage: string;
  observationPoint: string | null;
  rootCause: TaskReceiptRootCause;
  recoveryAction: string | null;
  evidence: TaskReceiptEvidence[];
  toolCalls: number;
  successfulToolResults: number;
  uncertainToolResults: number;
  failedToolResults: number;
  startedAt: number;
  updatedAt: number;
  durationMs: number;
};

type BuilderInput = {
  taskId: string;
  objective: string;
  mode: "conversation" | "action";
  startedAt: number;
};

type ToolObservation = {
  tool: string;
  classification: ActionResultClass;
  detail: string | null;
  knownCause: boolean;
};

const MAX_EXPECTED_CHARS = 240;
const MAX_DETAIL_CHARS = 180;
const MAX_EVIDENCE = 8;

/**
 * Builds a small, sanitized result receipt from the same authoritative event
 * seam that feeds the chat stream. It deliberately records no thoughts, raw
 * tool arguments, or full tool outputs. A successful tool return is observed
 * operational evidence, not automatic proof that the user's external goal was
 * achieved.
 */
export class TaskReceiptBuilder {
  private readonly expected: string;
  private readonly evidence: TaskReceiptEvidence[] = [];
  private readonly tools: ToolObservation[] = [];
  private toolCalls = 0;
  private finalSeen = false;
  private doneSeen = false;
  private errorMessage: string | null = null;
  private killedReason: "manual" | "stuck" | null = null;
  private pendingApproval: { tool: string; summary: string } | null = null;
  private deniedApproval: { tool: string; status: "denied" | "expired" } | null = null;
  private firstProblem: string | null = null;
  private lastSuccessfulTool: string | null = null;

  constructor(private readonly input: BuilderInput) {
    this.expected = safeText(input.objective, MAX_EXPECTED_CHARS) || "Complete the requested AVA task.";
    this.addEvidence({
      kind: "request",
      label: "Request accepted",
      detail: "AVA created an agent run for this request.",
      strength: "verified",
    });
  }

  get terminal(): boolean {
    return this.doneSeen || this.errorMessage !== null || this.killedReason !== null;
  }

  observe(event: AgentEvent): void {
    switch (event.kind) {
      case "thought":
      case "delta":
        return;
      case "tool_call":
        this.toolCalls += 1;
        return;
      case "tool_result": {
        const classification = classifyActionResult({
          output: event.payload.result,
          is_error: !event.payload.ok,
        });
        const detail = classification === "ok"
          ? null
          : safeText(event.payload.result, MAX_DETAIL_CHARS) || "The tool returned no diagnostic detail.";
        this.tools.push({
          tool: event.payload.tool,
          classification,
          detail,
          knownCause: classification === "error" && isKnownToolFailure(detail),
        });
        if (classification === "ok") {
          this.lastSuccessfulTool = event.payload.tool;
          this.addEvidence({
            kind: "tool_result",
            label: `${displayTool(event.payload.tool)} reported success`,
            detail: "The executor returned successfully. This does not by itself verify an external outcome.",
            strength: "observed",
          });
        } else {
          this.firstProblem ??= `${displayTool(event.payload.tool)} returned ${classification === "error" ? "an error" : "an incomplete or uncertain result"}.`;
          this.addEvidence({
            kind: "tool_result",
            label: `${displayTool(event.payload.tool)} ${classification === "error" ? "failed" : "was uncertain"}`,
            detail: detail ?? "No additional detail was recorded.",
            strength: "observed",
          });
        }
        return;
      }
      case "approval_required":
        this.pendingApproval = {
          tool: event.payload.tool,
          summary: safeText(event.payload.summary, MAX_DETAIL_CHARS),
        };
        this.addEvidence({
          kind: "approval",
          label: `Approval required for ${displayTool(event.payload.tool)}`,
          detail: this.pendingApproval.summary || "AVA is waiting for Niko's decision.",
          strength: "verified",
        });
        return;
      case "approval_resolved": {
        const tool = this.pendingApproval?.tool ?? "the requested action";
        if (event.payload.status === "approved") {
          this.pendingApproval = null;
          this.deniedApproval = null;
          this.addEvidence({
            kind: "approval",
            label: "Approval granted",
            detail: "Execution was allowed to continue.",
            strength: "verified",
          });
        } else {
          this.pendingApproval = null;
          this.deniedApproval = { tool, status: event.payload.status };
          this.firstProblem ??= `Approval for ${displayTool(tool)} was ${event.payload.status}.`;
          this.addEvidence({
            kind: "approval",
            label: `Approval ${event.payload.status}`,
            detail: "The protected action was not executed.",
            strength: "verified",
          });
        }
        return;
      }
      case "final":
        this.finalSeen = true;
        this.addEvidence({
          kind: "response",
          label: "Response delivered",
          detail: "AVA's final response reached the conversation stream.",
          strength: "verified",
        });
        return;
      case "error":
        this.errorMessage = safeText(event.payload.message, MAX_DETAIL_CHARS) || "The agent runtime returned an error.";
        this.firstProblem ??= "The AVA agent runtime returned an error.";
        this.addEvidence({
          kind: "runtime",
          label: "Agent runtime error",
          detail: this.errorMessage,
          strength: "observed",
        });
        return;
      case "killed":
        this.killedReason = event.payload.reason ?? "manual";
        this.firstProblem ??= this.killedReason === "manual"
          ? "Niko stopped the run before it finished."
          : "AVA stopped the run after detecting no progress.";
        this.addEvidence({
          kind: "runtime",
          label: this.killedReason === "manual" ? "Run stopped by Niko" : "Run halted by AVA",
          detail: "The task ended before a verified completion boundary.",
          strength: "verified",
        });
        return;
      case "done":
        this.doneSeen = true;
        return;
    }
  }

  snapshot(at = Date.now()): TaskReceipt {
    const successes = this.tools.filter((t) => t.classification === "ok").length;
    const uncertain = this.tools.filter((t) => t.classification === "uncertain").length;
    const failures = this.tools.filter((t) => t.classification === "error").length;
    const state = this.classifyState({ successes, uncertain, failures });
    const observationPoint = this.observationPoint(state.outcome);

    return {
      schemaVersion: TASK_RECEIPT_SCHEMA_VERSION,
      taskId: this.input.taskId,
      expected: this.expected,
      actual: this.actualSummary(state.lifecycle, state.outcome, { successes, uncertain, failures }),
      lifecycle: state.lifecycle,
      outcome: state.outcome,
      verificationScope: state.verificationScope,
      lastVerifiedStage: this.lastVerifiedStage(state.outcome),
      observationPoint,
      rootCause: this.rootCause(state.lifecycle, state.outcome),
      recoveryAction: this.recoveryAction(state.lifecycle, state.outcome),
      evidence: [...this.evidence],
      toolCalls: this.toolCalls,
      successfulToolResults: successes,
      uncertainToolResults: uncertain,
      failedToolResults: failures,
      startedAt: this.input.startedAt,
      updatedAt: at,
      durationMs: Math.max(0, at - this.input.startedAt),
    };
  }

  private classifyState(counts: { successes: number; uncertain: number; failures: number }): {
    lifecycle: TaskReceiptLifecycle;
    outcome: TaskReceiptOutcome;
    verificationScope: TaskReceipt["verificationScope"];
  } {
    if (this.errorMessage) return { lifecycle: "failed", outcome: "failed", verificationScope: "none" };
    if (this.killedReason) {
      return {
        lifecycle: "cancelled",
        outcome: counts.successes > 0 ? "partial" : "unverified",
        verificationScope: counts.successes > 0 ? "operational_steps" : "none",
      };
    }
    if (this.deniedApproval) return { lifecycle: "blocked", outcome: "failed", verificationScope: "none" };
    if (this.pendingApproval) return { lifecycle: "awaiting_approval", outcome: "unverified", verificationScope: "none" };
    if (!this.doneSeen) return { lifecycle: "running", outcome: "unverified", verificationScope: "none" };
    if (!this.finalSeen) return { lifecycle: "failed", outcome: "failed", verificationScope: "none" };
    if (counts.failures > 0) {
      return {
        lifecycle: "finished",
        outcome: counts.successes > 0 || counts.uncertain > 0 ? "partial" : "failed",
        verificationScope: counts.successes > 0 ? "operational_steps" : "none",
      };
    }
    if (counts.uncertain > 0) {
      return { lifecycle: "finished", outcome: "partial", verificationScope: "operational_steps" };
    }
    if (this.input.mode === "conversation" && this.toolCalls === 0) {
      return { lifecycle: "finished", outcome: "verified", verificationScope: "response_delivery" };
    }
    if (this.toolCalls === 0) {
      // Typed routing deliberately exposes the full tool agent for ambiguous
      // requests. When it answers directly, delivery is proven even though the
      // requested task outcome remains unverified.
      return { lifecycle: "finished", outcome: "unverified", verificationScope: "response_delivery" };
    }
    return {
      lifecycle: "finished",
      outcome: "unverified",
      verificationScope: counts.successes > 0 ? "operational_steps" : "none",
    };
  }

  private actualSummary(
    lifecycle: TaskReceiptLifecycle,
    outcome: TaskReceiptOutcome,
    counts: { successes: number; uncertain: number; failures: number },
  ): string {
    if (lifecycle === "awaiting_approval") return "AVA paused before a protected action and is waiting for Niko's approval.";
    if (lifecycle === "blocked") return "The protected action was not executed because approval was denied or expired.";
    if (lifecycle === "cancelled") return "The run stopped before a verified completion boundary.";
    if (lifecycle === "failed") return "The AVA agent runtime ended without a verified result.";
    if (lifecycle === "running") return "AVA is still working on this request.";
    if (outcome === "verified" && this.input.mode === "conversation") {
      return "AVA delivered the requested conversational response; no external action was claimed.";
    }
    if (this.toolCalls === 0) {
      return "AVA delivered a response, but no external action or independently verified task outcome was observed.";
    }
    if (outcome === "partial" || outcome === "failed") {
      return `AVA returned a response after ${counts.successes} successful, ${counts.uncertain} uncertain, and ${counts.failures} failed tool result${this.tools.length === 1 ? "" : "s"}.`;
    }
    return `AVA returned a response after ${counts.successes} tool result${counts.successes === 1 ? "" : "s"} reported success; the requested external outcome was not independently verified.`;
  }

  private lastVerifiedStage(outcome: TaskReceiptOutcome): string {
    if (this.finalSeen && this.toolCalls === 0) return "The final response reached this conversation.";
    if (this.lastSuccessfulTool) return `${displayTool(this.lastSuccessfulTool)} returned a successful operational result.`;
    return "AVA accepted the request and created the task run.";
  }

  private observationPoint(outcome: TaskReceiptOutcome): string | null {
    if (this.pendingApproval) return `Execution paused at the approval boundary for ${displayTool(this.pendingApproval.tool)}.`;
    if (this.firstProblem) return this.firstProblem;
    if (outcome === "unverified" && this.toolCalls > 0) {
      return "Evidence stopped at the tool-result boundary; no independent outcome verifier ran.";
    }
    if (outcome === "unverified") return "No independently verifiable action boundary was observed.";
    return null;
  }

  private rootCause(lifecycle: TaskReceiptLifecycle, outcome: TaskReceiptOutcome): TaskReceiptRootCause {
    if (this.deniedApproval || this.pendingApproval || this.killedReason === "manual") return "known";
    const failedTools = this.tools.filter((tool) => tool.classification === "error");
    if (failedTools.length > 0 && failedTools.every((tool) => tool.knownCause)) return "known";
    if (this.errorMessage || this.tools.some((t) => t.classification !== "ok") || this.killedReason === "stuck") return "likely";
    if (outcome === "unverified") return "unknown";
    if (lifecycle === "running") return "unknown";
    return "not_applicable";
  }

  private recoveryAction(lifecycle: TaskReceiptLifecycle, outcome: TaskReceiptOutcome): string | null {
    if (lifecycle === "awaiting_approval") return "Review the approval card, then approve or deny the protected action.";
    if (lifecycle === "blocked") return "Revise the request or retry and approve the protected action if it is intended.";
    if (lifecycle === "cancelled") return "Send the request again or ask AVA to continue from the last proven stage.";
    if (lifecycle === "failed") return "Retry once; if it repeats, open the diagnostic receipt and share the task ID.";
    if (outcome === "partial") return "Retry the failed or uncertain stage, then verify the requested outcome.";
    if (outcome === "unverified") return "Check the real result before relying on it, or ask AVA to verify it explicitly.";
    return null;
  }

  private addEvidence(item: TaskReceiptEvidence): void {
    // Preserve the initial request boundary and the most recent evidence. This
    // keeps the receipt bounded without losing the terminal response or a late
    // failure after a long tool sequence.
    if (this.evidence.length >= MAX_EVIDENCE) {
      this.evidence.splice(1, 1);
    }
    this.evidence.push(item);
  }
}

function displayTool(tool: string): string {
  return tool.trim().replaceAll("_", " ") || "tool";
}

function safeText(value: unknown, max: number): string {
  const cleaned = scrubSecrets(String(value ?? ""))
    // Strip whole ANSI CSI/OSC escapes before removing control characters;
    // deleting ESC first used to leave visible fragments such as `[2m`.
    .replace(/\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g, "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > max ? `${cleaned.slice(0, Math.max(0, max - 1))}…` : cleaned;
}

function isKnownToolFailure(detail: string | null): boolean {
  if (!detail) return false;
  return /(?:\bENOENT\b|no such file or directory|path not in allowlist|\bEACCES\b|access is denied|permission denied)/i.test(detail);
}
