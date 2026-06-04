import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { approveApproval, denyApproval } from "../api.js";

export function ApprovalCard({
  id,
  tool,
  args,
  summary,
  resolvedStatus,
}: {
  id: string;
  tool: string;
  args: unknown;
  summary: string;
  resolvedStatus: "approved" | "denied" | "expired" | null;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (resolvedStatus) {
    const label =
      resolvedStatus === "approved" ? "Approved" :
      resolvedStatus === "denied" ? "Denied" : "Expired";
    const cls =
      resolvedStatus === "approved" ? "text-[var(--ava-jade)]" :
      resolvedStatus === "denied" ? "text-red-400" : "text-[var(--ava-fg-faint)]";
    return (
      <div data-testid="approval-card-resolved" data-status={resolvedStatus} className={`font-mono text-xs ${cls}`}>
        {label} / {tool} / {new Date().toLocaleTimeString()}
      </div>
    );
  }

  async function act(action: "approve" | "deny") {
    setBusy(true);
    setErr(null);
    try {
      if (action === "approve") await approveApproval(id);
      else await denyApproval(id);
    } catch (e) {
      setErr(String(e));
      setBusy(false);
    }
  }

  return (
    <div data-testid="approval-card" className="ava-glass-panel my-2 max-w-[90%] p-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-[var(--ava-gold)]">
        <ShieldAlert size={16} />
        <span>Ava wants to: {summary}</span>
      </div>
      <div className="mt-2 font-mono text-xs text-[var(--ava-fg-muted)]">
        Tool: {tool}
      </div>
      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-[8px] border border-[var(--ava-border)] bg-black/35 p-2 font-mono text-xs text-[var(--ava-fg-muted)]">
        {JSON.stringify(args, null, 2)}
      </pre>
      {err && <div className="mt-2 text-xs text-red-400">{err}</div>}
      <div className="mt-3 flex gap-2">
        <button
          data-testid="approval-deny"
          onClick={() => act("deny")}
          disabled={busy}
          className="ava-secondary-button px-3 py-1.5 text-sm disabled:opacity-50"
        >
          Deny
        </button>
        <button
          data-testid="approval-approve"
          onClick={() => act("approve")}
          disabled={busy}
          className="ava-primary-button px-3 py-1.5 text-sm disabled:opacity-50"
        >
          Approve
        </button>
      </div>
    </div>
  );
}
