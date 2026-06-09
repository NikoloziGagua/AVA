import { useSelfJournal, isRunningStatus, planText } from "./useSelfJournal.js";
import { PanelShell, PanelSection } from "../components/ava/PanelShell.js";

export function SelfScreen(_props: { onClose?: () => void }) {
  const { intents, paused, setPaused, revertLast, cancel, approve, reject } = useSelfJournal();
  const canRevert = intents.some((i) => i.status === "swapped");

  return (
    <PanelShell title="Self-improvement">
      <PanelSection title="Controls">
        <div className="flex gap-3">
          <button
            onClick={() => setPaused(!paused)}
            aria-pressed={paused}
            className="px-3 py-1.5 text-xs rounded-md border border-white/15 text-white/85 hover:border-[rgba(92,242,255,0.4)] active:scale-95 transition-all"
          >
            {paused ? "Resume" : "Pause"}
          </button>
          <button
            onClick={revertLast}
            disabled={!canRevert}
            className="px-3 py-1.5 text-xs rounded-md border border-white/15 text-white/85 hover:border-[rgba(92,242,255,0.4)] active:scale-95 transition-all disabled:opacity-40"
          >
            Revert last
          </button>
        </div>
        <div className="text-[10px] text-white/40 mt-2">
          {paused
            ? "Paused — Ava won't act on self-improvements."
            : "Active — Ava may refine how it works for you."}
        </div>
      </PanelSection>

      <PanelSection title="Journal">
        <ul className="space-y-1.5">
          {intents.length === 0 && (
            <li className="text-xs text-white/40">no self-improvements yet.</li>
          )}
          {intents.map((i) => (
            <li
              key={i.id}
              className="border border-white/8 rounded-md px-3 py-2 hover:border-[rgba(92,242,255,0.3)] transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm text-white/85">{i.goal}</div>
                {isRunningStatus(i.status) && (
                  <button
                    onClick={() => cancel(i.id)}
                    className="shrink-0 px-2 py-1 text-[10px] rounded-md border border-[rgba(255,90,90,0.4)] text-[rgba(255,140,140,0.95)] hover:bg-[rgba(255,90,90,0.12)] active:scale-95 transition-all"
                  >
                    Stop
                  </button>
                )}
              </div>
              <div className="text-[10px] uppercase tracking-widest text-white/40 mt-1">
                {i.status === "awaiting_approval" ? "awaiting your approval" : i.status}
                {i.outcome ? ` · ${i.outcome}` : ""}
              </div>
              {i.status === "awaiting_approval" && (
                <div className="mt-2 rounded-md border border-[rgba(92,242,255,0.22)] bg-[rgba(92,242,255,0.05)] p-2">
                  <div className="hud text-[10px] text-white/50 mb-1">Plan — review before it runs</div>
                  <pre className="whitespace-pre-wrap break-words text-[11px] leading-snug text-white/80 max-h-44 overflow-y-auto no-scrollbar">
                    {planText(i.diff_summary) || "(no plan text)"}
                  </pre>
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => approve(i.id)}
                      className="px-3 py-1.5 text-xs rounded-md border border-[rgba(92,242,255,0.5)] text-[rgba(92,242,255,0.95)] hover:bg-[rgba(92,242,255,0.12)] active:scale-95 transition-all"
                    >
                      Approve & run
                    </button>
                    <button
                      onClick={() => reject(i.id)}
                      className="px-3 py-1.5 text-xs rounded-md border border-[rgba(255,90,90,0.4)] text-[rgba(255,140,140,0.95)] hover:bg-[rgba(255,90,90,0.12)] active:scale-95 transition-all"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </PanelSection>
    </PanelShell>
  );
}
