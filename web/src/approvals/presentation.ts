import { useEffect, useState } from "react";

export type ApprovalRiskTier = "medium" | "high";
export type ApprovalTimeoutBehavior = "auto_approve" | "auto_deny";

/**
 * Policy evidence emitted by AVA's authoritative server. Fields stay optional
 * in the browser so a retained pre-upgrade event degrades to neutral copy
 * instead of inventing its risk or timeout behavior.
 */
export type ApprovalPolicyEvidence = {
  riskTier?: ApprovalRiskTier;
  timeoutBehavior?: ApprovalTimeoutBehavior;
  requestedAt?: number;
  deadlineAt?: number;
  timeoutMs?: number;
};

export type ApprovalTiming = {
  remainingSeconds: number | null;
  progressPercent: number | null;
  deadlineReached: boolean;
};

function finitePositive(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function approvalTiming(
  evidence: ApprovalPolicyEvidence,
  now: number = Date.now(),
): ApprovalTiming {
  if (!finitePositive(evidence.deadlineAt)) {
    return { remainingSeconds: null, progressPercent: null, deadlineReached: false };
  }
  const remainingMs = Math.max(0, evidence.deadlineAt - now);
  const progressPercent = finitePositive(evidence.timeoutMs)
    ? Math.min(100, Math.max(0, (remainingMs / evidence.timeoutMs) * 100))
    : null;
  return {
    remainingSeconds: Math.ceil(remainingMs / 1_000),
    progressPercent,
    deadlineReached: remainingMs === 0,
  };
}

export function useApprovalTiming(
  evidence: ApprovalPolicyEvidence | null,
  active: boolean = true,
): ApprovalTiming {
  const [now, setNow] = useState(() => Date.now());
  const deadlineAt = evidence?.deadlineAt;
  const timeoutMs = evidence?.timeoutMs;

  useEffect(() => {
    setNow(Date.now());
    if (!active || !finitePositive(deadlineAt) || deadlineAt <= Date.now()) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [active, deadlineAt]);

  return approvalTiming({ deadlineAt, timeoutMs }, now);
}

export function approvalRiskLabel(evidence: ApprovalPolicyEvidence): string {
  if (evidence.riskTier === "high") return "High risk";
  if (evidence.riskTier === "medium") return "Medium risk";
  return "Risk not recorded";
}

export function approvalTimeoutLabel(evidence: ApprovalPolicyEvidence): string {
  if (evidence.timeoutBehavior === "auto_deny") return "Silence auto-denies";
  if (evidence.timeoutBehavior === "auto_approve") return "Silence auto-approves";
  return "Timeout behavior not recorded";
}

export function pendingApprovalCopy(
  evidence: ApprovalPolicyEvidence,
  timing: ApprovalTiming,
): string {
  const remaining = timing.remainingSeconds;
  if (evidence.timeoutBehavior === "auto_deny") {
    if (remaining == null) return "High-risk action waits for approval; silence will not run it.";
    if (timing.deadlineReached) return "Auto-deny deadline reached — waiting for server confirmation.";
    return `Auto-denying in ${remaining}s — approve now to run.`;
  }
  if (evidence.timeoutBehavior === "auto_approve") {
    if (remaining == null) return "Medium-risk action is waiting for your decision.";
    if (timing.deadlineReached) return "Auto-approve deadline reached — waiting for server confirmation.";
    return `Auto-approving in ${remaining}s — cancel to stop.`;
  }
  if (remaining == null) return "Waiting for the server's approval decision.";
  if (timing.deadlineReached) return "Decision deadline reached — waiting for server confirmation.";
  return `Decision window ends in ${remaining}s.`;
}

export function resolvedApprovalCopy(
  status: "approved" | "denied" | "expired",
  evidence: ApprovalPolicyEvidence,
): string {
  if (status === "approved") {
    return evidence.riskTier === "high"
      ? "Approved · high-risk action may continue."
      : "Approved · action may continue.";
  }
  if (status === "denied") return "Denied · action did not run.";
  return evidence.riskTier === "high"
    ? "Not approved · high-risk action did not run."
    : evidence.riskTier === "medium"
      ? "Cancelled or expired · action did not run."
      : "Expired · action did not run.";
}
