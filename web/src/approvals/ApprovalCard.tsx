import { useId, useState } from "react";
import { motion } from "motion/react";
import { ShieldAlert } from "lucide-react";
import { approveApproval, denyApproval } from "../api.js";
import { humanizeTool } from "../chat/humanize.js";
import {
  approvalRiskLabel,
  approvalTimeoutLabel,
  pendingApprovalCopy,
  resolvedApprovalCopy,
  useApprovalTiming,
  type ApprovalPolicyEvidence,
} from "./presentation.js";

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
}: {
  id: string;
  tool: string;
  args: unknown;
  summary: string;
  resolvedStatus: "approved" | "denied" | "expired" | null;
} & ApprovalPolicyEvidence) {
  const [busyAction, setBusyAction] = useState<"approve" | "deny" | null>(null);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const titleId = useId();
  const statusId = useId();
  const policyEvidence = { riskTier, timeoutBehavior, requestedAt, deadlineAt, timeoutMs };
  // The server supplies an absolute deadline. Reconnects/remounts therefore
  // resume the same veto window instead of showing a false fresh 15 seconds.
  const timing = useApprovalTiming(policyEvidence, !busyAction && !resolvedStatus);

  if (resolvedStatus) {
    const color =
      resolvedStatus === "approved" ? "var(--ac-live)" :
      resolvedStatus === "denied" ? "var(--ac-stop)" : "rgba(255,255,255,0.4)";
    return (
      <div
        data-testid="approval-card-resolved"
        data-status={resolvedStatus}
        data-risk-tier={riskTier ?? "unknown"}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="my-1 flex items-center gap-1.5 text-[11px]"
        style={{ color, fontFamily: "var(--font-mono)" }}
      >
        <span aria-hidden="true">{resolvedStatus === "denied" ? "✕" : resolvedStatus === "approved" ? "✓" : "○"}</span>
        {resolvedApprovalCopy(resolvedStatus, policyEvidence)} · {humanizeTool(tool, args)}
      </div>
    );
  }

  async function act(action: "approve" | "deny") {
    setBusyAction(action);
    setErr(null);
    try {
      if (action === "approve") await approveApproval(id);
      else await denyApproval(id);
    } catch (e) {
      setErr(String(e));
      setBusyAction(null);
    }
    // Don't clear busy on success — the resolved-state version replaces this
    // once the authoritative SSE approval_resolved event arrives.
  }

  return (
    <motion.div
      data-testid="approval-card"
      data-risk-tier={riskTier ?? "unknown"}
      data-timeout-behavior={timeoutBehavior ?? "unknown"}
      role="region"
      aria-labelledby={titleId}
      aria-describedby={statusId}
      layout
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="my-3 w-full max-w-md overflow-hidden rounded-2xl"
      style={{
        background: "linear-gradient(180deg, rgba(20,16,8,0.72), rgba(10,8,4,0.72))",
        border: "1px solid rgba(255,212,121,0.30)",
        backdropFilter: "blur(20px) saturate(150%)",
        WebkitBackdropFilter: "blur(20px) saturate(150%)",
        boxShadow: "0 20px 60px -20px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.08)",
      }}
    >
      {/* The bar mirrors the server's absolute deadline; it never decides. */}
      {timing.progressPercent != null && (
        <div className="h-[3px] w-full" style={{ background: "rgba(255,255,255,0.06)" }}>
          <motion.div
            data-testid="approval-deadline-progress"
            className="h-full"
            style={{ background: "var(--ac-exec)" }}
            animate={{ width: `${timing.progressPercent}%` }}
            transition={{ duration: 0.25, ease: "linear" }}
          />
        </div>
      )}

      <div className="p-4">
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-7 w-7 items-center justify-center rounded-full"
            style={{ background: "rgba(255,212,121,0.14)", color: "var(--ac-exec)" }}
          >
            <ShieldAlert size={16} />
          </span>
          <div>
            <h3 id={titleId} className="text-[15px] font-semibold text-white">
              {riskTier === "high" ? "Approve this high-risk action?" : "Approve this action?"}
            </h3>
            <div className="mt-0.5 flex gap-2 text-[9px] uppercase tracking-wider text-white/40">
              <span>{approvalRiskLabel(policyEvidence)}</span>
              <span aria-hidden="true">·</span>
              <span>{approvalTimeoutLabel(policyEvidence)}</span>
            </div>
          </div>
        </div>

        <p className="mt-2 text-[14px] leading-relaxed text-white/85">
          Ava wants to <span className="font-medium text-white">{humanizeTool(tool, args)}</span>.
        </p>
        <p
          id={statusId}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="mt-1.5 text-[12px]"
          style={{ color: "var(--ac-exec)" }}
        >
          {busyAction === "approve"
            ? "Submitting approval…"
            : busyAction === "deny"
              ? "Submitting denial…"
              : pendingApprovalCopy(policyEvidence, timing)}
        </p>

        <button
          onClick={() => setOpen((v) => !v)}
          className="mt-2 text-[11px] text-white/40 transition-colors hover:text-white/70"
        >
          {open ? "▾ hide details" : "▸ details"}
        </button>
        {open && (
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/40 p-2 font-mono text-[10.5px] text-white/60">
            {tool}{"\n"}{JSON.stringify(args, null, 2)}
          </pre>
        )}
        {err && <div role="alert" className="mt-2 text-xs text-red-400">{err}</div>}
      </div>

      <div className="flex border-t" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
        <button
          data-testid="approval-deny"
          onClick={() => act("deny")}
          disabled={busyAction != null}
          className="flex-1 py-3 text-sm font-medium text-white/60 transition-colors hover:bg-white/5 hover:text-white/90 disabled:opacity-50"
        >
          Cancel
        </button>
        <div style={{ width: 1, background: "rgba(255,255,255,0.08)" }} />
        <button
          data-testid="approval-approve"
          onClick={() => act("approve")}
          disabled={busyAction != null}
          className="flex-1 py-3 text-sm font-semibold transition-colors disabled:opacity-50"
          style={{ color: "var(--ac)" }}
        >
          Approve now
        </button>
      </div>
    </motion.div>
  );
}
