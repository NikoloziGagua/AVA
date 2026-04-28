import type { Db } from "../state/db.js";
import { enforce } from "./enforce.js";
import { createApproval, waitForDecision, type Approval } from "../state/approvals.js";

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
  /** Default 600_000 ms (10 min). */
  approvalTimeoutMs?: number;
};

export type PolicyHook = (toolName: string, args: unknown) => Promise<PolicyOutcome>;

function summarize(toolName: string, args: unknown): string {
  const argSnippet = (() => {
    try {
      const s = JSON.stringify(args);
      return s.length > 200 ? s.slice(0, 200) + "…" : s;
    } catch {
      return "<unserialisable>";
    }
  })();
  return `${toolName}(${argSnippet})`;
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
    const r = await waitForDecision(opts.db, approval.id, opts.approvalTimeoutMs);
    opts.emit({ kind: "approval_resolved", payload: { id: approval.id, status: r.status as "approved" | "denied" | "expired" } });
    if (r.status === "approved") return { allow: true };
    return { allow: false, message: `DENIED (${r.status})` };
  };
}
