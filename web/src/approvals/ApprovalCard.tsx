import { useState } from "react";
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
      resolvedStatus === "approved" ? "text-emerald-400" :
      resolvedStatus === "denied" ? "text-red-400" : "text-neutral-500";
    return (
      <div className={`text-xs ${cls} font-mono`}>
        {label} · {tool} · {new Date().toLocaleTimeString()}
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
    // Don't clear busy on success — the card will be replaced by the resolved-state version once
    // the SSE approval_resolved event arrives.
  }

  return (
    <div className="border border-amber-500 rounded-lg bg-amber-900/30 p-3 my-2 max-w-[90%]">
      <div className="flex items-center gap-2 text-sm font-semibold text-amber-200">
        <span>⚠</span>
        <span>Ava wants to: {summary}</span>
      </div>
      <div className="text-xs text-amber-100/70 font-mono mt-2">
        Tool: {tool}
      </div>
      <pre className="text-xs text-amber-100/70 font-mono mt-1 whitespace-pre-wrap break-words bg-black/30 p-2 rounded">
        {JSON.stringify(args, null, 2)}
      </pre>
      {err && <div className="text-xs text-red-400 mt-2">{err}</div>}
      <div className="flex gap-2 mt-3">
        <button
          onClick={() => act("deny")}
          disabled={busy}
          className="bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-sm px-3 py-1.5 rounded text-white"
        >
          Deny
        </button>
        <button
          onClick={() => act("approve")}
          disabled={busy}
          className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-sm px-3 py-1.5 rounded text-white"
        >
          Approve
        </button>
      </div>
    </div>
  );
}
