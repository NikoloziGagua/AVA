import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { ShieldAlert } from "lucide-react";
import { approveApproval, denyApproval } from "../api.js";
import { humanizeTool } from "../chat/humanize.js";

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
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Veto window: the server auto-approves after 15s unless Sir declines. This
  // countdown just mirrors that so he knows how long he has to hit Cancel.
  const AUTO_APPROVE_S = 15;
  const [remaining, setRemaining] = useState(AUTO_APPROVE_S);
  useEffect(() => {
    if (busy) return; // a tap settles it — stop the countdown
    const t = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearInterval(t);
  }, [busy]);

  if (resolvedStatus) {
    const label =
      resolvedStatus === "approved" ? "Approved" :
      resolvedStatus === "denied" ? "Denied" : "Expired";
    const color =
      resolvedStatus === "approved" ? "var(--ac-live)" :
      resolvedStatus === "denied" ? "var(--ac-stop)" : "rgba(255,255,255,0.4)";
    return (
      <div
        data-testid="approval-card-resolved"
        data-status={resolvedStatus}
        className="my-1 flex items-center gap-1.5 text-[11px]"
        style={{ color, fontFamily: "var(--font-mono)" }}
      >
        <span>{resolvedStatus === "denied" ? "✕" : resolvedStatus === "approved" ? "✓" : "○"}</span>
        {label} · {humanizeTool(tool, args)}
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
    // Don't clear busy on success — the resolved-state version replaces this
    // once the SSE approval_resolved event arrives.
  }

  return (
    <motion.div
      data-testid="approval-card"
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
      {/* 15s veto-window countdown bar */}
      <div className="h-[3px] w-full" style={{ background: "rgba(255,255,255,0.06)" }}>
        <motion.div
          className="h-full"
          style={{ background: "var(--ac-exec)" }}
          animate={{ width: `${(remaining / AUTO_APPROVE_S) * 100}%` }}
          transition={{ duration: 1, ease: "linear" }}
        />
      </div>

      <div className="p-4">
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-7 w-7 items-center justify-center rounded-full"
            style={{ background: "rgba(255,212,121,0.14)", color: "var(--ac-exec)" }}
          >
            <ShieldAlert size={16} />
          </span>
          <h3 className="text-[15px] font-semibold text-white">Approve this action?</h3>
        </div>

        <p className="mt-2 text-[14px] leading-relaxed text-white/85">
          Ava wants to <span className="font-medium text-white">{humanizeTool(tool, args)}</span>.
        </p>
        <p className="mt-1.5 text-[12px]" style={{ color: "var(--ac-exec)" }}>
          {busy ? "Settling…" : remaining > 0 ? `Auto-approving in ${remaining}s — Cancel to stop.` : "Approving…"}
        </p>

        <button
          onClick={() => setOpen((v) => !v)}
          className="mt-2 text-[11px] text-white/40 hover:text-white/70 transition-colors"
        >
          {open ? "▾ hide details" : "▸ details"}
        </button>
        {open && (
          <pre className="mt-1 max-h-40 overflow-auto rounded-lg bg-black/40 p-2 text-[10.5px] font-mono whitespace-pre-wrap break-words text-white/60">
            {tool}{"\n"}{JSON.stringify(args, null, 2)}
          </pre>
        )}
        {err && <div className="mt-2 text-xs text-red-400">{err}</div>}
      </div>

      <div className="flex border-t" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
        <button
          data-testid="approval-deny"
          onClick={() => act("deny")}
          disabled={busy}
          className="flex-1 py-3 text-sm font-medium text-white/60 hover:bg-white/5 hover:text-white/90 disabled:opacity-50 transition-colors"
        >
          Cancel
        </button>
        <div style={{ width: 1, background: "rgba(255,255,255,0.08)" }} />
        <button
          data-testid="approval-approve"
          onClick={() => act("approve")}
          disabled={busy}
          className="flex-1 py-3 text-sm font-semibold disabled:opacity-50 transition-colors"
          style={{ color: "var(--ac)" }}
        >
          Approve now
        </button>
      </div>
    </motion.div>
  );
}
