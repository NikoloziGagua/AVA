import type { Db } from "../state/db.js";
import { enforce } from "./enforce.js";
import { createApproval, waitForDecision, type Approval } from "../state/approvals.js";
import { redactSensitiveArgs } from "../orchestrator/redact.js";

export type PolicyEvent =
  | { kind: "approval_required"; payload: { id: string; tool: string; args: unknown; summary: string } }
  | { kind: "approval_resolved"; payload: { id: string; status: "approved" | "denied" | "expired" } };

export type PolicyOutcome =
  | { allow: true }
  | { allow: false; message: string };

export type PolicyHookArgs = {
  db: Db;
  sessionId: string;
  emit: (e: PolicyEvent) => void;
  pushDeliver?: (a: Approval) => Promise<void>;
  /** The veto window before an undecided approval auto-approves. Default 15s
   *  (override with APPROVAL_AUTO_APPROVE_MS). */
  approvalTimeoutMs?: number;
  /** The run's abort signal. Threaded into waitForDecision so a Stop during the
   *  veto window resolves immediately as expired (not auto-approved) — Stop must
   *  cancel a pending approval, never run the tool. */
  signal?: AbortSignal;
};

export type PolicyHook = (toolName: string, args: unknown) => Promise<PolicyOutcome>;

function summarize(toolName: string, args: unknown): string {
  const argSnippet = (() => {
    try {
      // Approval summaries land in the DB and push notifications — redact
      // credentials the same way the event stream does.
      const s = JSON.stringify(redactSensitiveArgs(args));
      return s.length > 200 ? s.slice(0, 200) + "…" : s;
    } catch {
      return "<unserialisable>";
    }
  })();
  return `${toolName}(${argSnippet})`;
}

const DEFAULT_AUTO_APPROVE_MS = 15_000;
function autoApproveMs(): number {
  const n = Number(process.env.APPROVAL_AUTO_APPROVE_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_AUTO_APPROVE_MS;
}

export function buildPolicyHook(opts: PolicyHookArgs): PolicyHook {
  return async (toolName, args) => {
    const e = enforce({ tool: toolName, args, db: opts.db });

    if (e.decision === "allow") return { allow: true };

    if (e.decision === "blocked") {
      return { allow: false, message: `BLOCKED: ${e.reason}` };
    }

    // e.decision === "ask"
    const approval = createApproval(opts.db, {
      sessionId: opts.sessionId,
      tool: toolName,
      args,
      summary: summarize(toolName, args),
    });
    opts.emit({
      kind: "approval_required",
      payload: { id: approval.id, tool: toolName, args, summary: approval.summary },
    });
    if (opts.pushDeliver) {
      void opts.pushDeliver(approval).catch(() => {
        // best-effort; push failures must not block approval flow
      });
    }
    // Sir gets a veto window. The timeout default depends on how destructive the
    // op is (the classifier tier carried on the "ask" decision):
    //   • medium → "approve": Sir didn't decline in time, so proceed (convenience).
    //   • high   → "expire": genuinely destructive (fs_delete, rm -rf, format,
    //     reg delete, shutdown, submit/checkout). If Sir never saw it, it is
    //     CANCELLED, not silently executed — auto-DENY, not auto-approve.
    // A Stop mid-window aborts the signal, which resolves this as expired (not
    // approved) so the pending tool is cancelled rather than run — in BOTH tiers.
    const onTimeout: "approve" | "expire" = e.tier === "high" ? "expire" : "approve";
    const r = await waitForDecision(
      opts.db, approval.id, opts.approvalTimeoutMs ?? autoApproveMs(), onTimeout, opts.signal,
    );
    opts.emit({ kind: "approval_resolved", payload: { id: approval.id, status: r.status as "approved" | "denied" | "expired" } });
    if (r.status === "approved") return { allow: true };
    return { allow: false, message: `DENIED (${r.status})` };
  };
}
