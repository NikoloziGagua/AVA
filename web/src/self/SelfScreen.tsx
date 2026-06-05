import { ChevronLeft } from "lucide-react";
import { useSelfJournal } from "./useSelfJournal.js";

export function SelfScreen({ onClose }: { onClose: () => void }) {
  const { intents, paused, setPaused, revertLast } = useSelfJournal();
  const canRevert = intents.some((i) => i.status === "swapped");

  return (
    <div
      className="no-scrollbar relative h-full overflow-y-auto text-white"
      style={{
        background:
          "radial-gradient(ellipse 70% 80% at 50% 0%, rgba(92,242,255,0.10), transparent 60%), radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px) 0 0 / 28px 28px, #000",
      }}
    >
      <header
        className="sticky top-0 z-10 flex items-center gap-2 px-4 py-4 h-16"
        style={{
          background: "rgba(0,0,0,0.55)",
          backdropFilter: "blur(20px) saturate(140%)",
          WebkitBackdropFilter: "blur(20px) saturate(140%)",
          borderBottom: "1px solid rgba(92,242,255,0.16)",
        }}
      >
        <button
          onClick={onClose}
          aria-label="close"
          className="w-9 h-9 rounded-full text-white/65 hover:text-white hover:bg-white/8 active:scale-95 flex items-center justify-center transition-all"
        >
          <ChevronLeft size={20} />
        </button>
        <div className="hud text-[13px] text-white/95">Self-improvement</div>
      </header>

      <section className="border-b border-white/5 px-4 py-3">
        <div className="hud text-xs text-white/55 mb-2">Controls</div>
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
      </section>

      <section className="px-4 py-3">
        <div className="hud text-xs text-white/55 mb-2">Journal</div>
        <ul className="space-y-1.5">
          {intents.length === 0 && (
            <li className="text-xs text-white/40">no self-improvements yet.</li>
          )}
          {intents.map((i) => (
            <li
              key={i.id}
              className="border border-white/8 rounded-md px-3 py-2 hover:border-[rgba(92,242,255,0.3)] transition-colors"
            >
              <div className="text-sm text-white/85">{i.goal}</div>
              <div className="text-[10px] uppercase tracking-widest text-white/40 mt-1">
                {i.status}
                {i.outcome ? ` · ${i.outcome}` : ""}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
