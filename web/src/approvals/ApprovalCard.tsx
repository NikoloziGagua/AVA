import { useId, useState } from "react";
import { ChevronDown, ChevronRight, CircleCheck, CircleOff, CircleX, ShieldAlert } from "lucide-react";
import { approveApproval, denyApproval } from "../api.js";
import { humanizeTool } from "../chat/humanize.js";
import { Button } from "../design/Button.js";
import { cn } from "../design/cn.js";
import {
  approvalRiskLabel,
  approvalTimeoutLabel,
  pendingApprovalCopy,
  resolvedApprovalCopy,
  useApprovalTiming,
  type ApprovalPolicyEvidence,
} from "./presentation.js";

/**
 * AVA asks before a risky action, in the conversation where it came up.
 *
 * This stays an inline card rather than a modal sheet on purpose: many
 * approvals are short veto windows where silence approves. A modal can be
 * dismissed with Esc or a tap outside, which feels like cancelling while the
 * countdown keeps running. Here, cancelling is always an explicit button.
 */
const serverDecision = (id: string, action: "approve" | "deny") => (action === "approve" ? approveApproval(id) : denyApproval(id));

export function ApprovalCard({
  id,
  tool,
  args,
  summary,
  resolvedStatus,
  riskTier,
  timeoutBehavior,
  requestedAt,
  deadlineAt,
  timeoutMs,
  decide = serverDecision,
}: {
  id: string;
  tool: string;
  args: unknown;
  summary: string;
  resolvedStatus: "approved" | "denied" | "expired" | null;
  /** Sends the decision; the server by default. The design gallery passes a stand-in so it never calls the server. */
  decide?: (id: string, action: "approve" | "deny") => Promise<unknown>;
} & ApprovalPolicyEvidence) {
  const [busyAction, setBusyAction] = useState<"approve" | "deny" | null>(null);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const titleId = useId();
  const statusId = useId();
  const detailsId = useId();
  const policyEvidence = { riskTier, timeoutBehavior, requestedAt, deadlineAt, timeoutMs };
  // The server supplies an absolute deadline. Reconnects/remounts therefore
  // resume the same veto window instead of showing a false fresh 15 seconds.
  const timing = useApprovalTiming(policyEvidence, !busyAction && !resolvedStatus);

  if (resolvedStatus) {
    const Icon = resolvedStatus === "approved" ? CircleCheck : resolvedStatus === "denied" ? CircleX : CircleOff;
    return (
      <div
        data-testid="approval-card-resolved"
        data-status={resolvedStatus}
        data-risk-tier={riskTier ?? "unknown"}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={cn(
          "flex w-fit max-w-full items-center gap-2 rounded-full px-3 py-1.5 text-meta",
          resolvedStatus === "approved" ? "bg-success-soft text-success" : resolvedStatus === "denied" ? "bg-danger-soft text-danger" : "bg-glass text-ink-2",
        )}
      >
        <Icon size={15} aria-hidden="true" className="shrink-0" />
        <span className="min-w-0">{resolvedApprovalCopy(resolvedStatus, policyEvidence)} · {humanizeTool(tool, args)}</span>
      </div>
    );
  }

  async function act(action: "approve" | "deny") {
    setBusyAction(action);
    setErr(null);
    try {
      await decide(id, action);
    } catch (e) {
      setErr(String(e));
      setBusyAction(null);
    }
    // Don't clear busy on success — the resolved-state version replaces this
    // once the authoritative SSE approval_resolved event arrives.
  }

  return (
    <div
      data-testid="approval-card"
      data-risk-tier={riskTier ?? "unknown"}
      data-timeout-behavior={timeoutBehavior ?? "unknown"}
      role="region"
      aria-labelledby={titleId}
      aria-describedby={statusId}
      className="ds-rise grid w-full max-w-md gap-4 rounded-card bg-surface p-5 shadow-e2"
    >
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-warning-soft text-warning">
          <ShieldAlert size={18} aria-hidden="true" />
        </span>
        <div className="grid min-w-0 gap-1">
          <h3 id={titleId} className="text-body-lg font-semibold text-ink">
            {riskTier === "high" ? "Approve this high-risk action?" : "Approve this action?"}
          </h3>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 font-ui-mono text-label uppercase text-ink-3">
            <span>{approvalRiskLabel(policyEvidence)}</span>
            <span>{approvalTimeoutLabel(policyEvidence)}</span>
          </div>
        </div>
      </div>

      <p className="text-body text-ink-2">
        AVA wants to <span className="font-medium text-ink">{humanizeTool(tool, args)}</span>.
      </p>

      <div className="grid gap-2">
        {/* The bar mirrors the server's absolute deadline; it never decides. */}
        {timing.progressPercent != null && (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-glass-strong">
            <div
              data-testid="approval-deadline-progress"
              className="h-full rounded-full bg-warning transition-[width] duration-250 ease-linear"
              style={{ width: `${timing.progressPercent}%` }}
            />
          </div>
        )}
        <p id={statusId} role="status" aria-live="polite" aria-atomic="true" className="text-meta font-medium text-warning">
          {busyAction === "approve"
            ? "Submitting approval…"
            : busyAction === "deny"
              ? "Submitting denial…"
              : pendingApprovalCopy(policyEvidence, timing)}
        </p>
      </div>

      <div className="grid gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={detailsId}
          className="ds-focus -ml-1 flex w-fit items-center gap-1 rounded-control px-1 text-meta text-ink-2 hover:text-ink"
        >
          {open ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
          {open ? "Hide details" : "Details"}
        </button>
        {open && (
          <pre id={detailsId} className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-control bg-glass p-3 font-ui-mono text-label text-ink-2">
            {tool}{"\n"}{JSON.stringify(args, null, 2)}
          </pre>
        )}
      </div>
      {err && <p role="alert" className="text-meta text-danger">{err}</p>}

      <div className="grid grid-cols-2 gap-2">
        <Button data-testid="approval-deny" variant="glass" onClick={() => act("deny")} disabled={busyAction != null}>
          Cancel
        </Button>
        <Button data-testid="approval-approve" variant="solid" onClick={() => act("approve")} disabled={busyAction != null}>
          Approve now
        </Button>
      </div>
    </div>
  );
}
