import { ChevronLeft, RotateCcw, Pause, Play } from "lucide-react";
import { useSelfJournal } from "./useSelfJournal.js";
import { useGsapReveal } from "../lib/useGsapReveal.js";

export function SelfScreen({ onClose }: { onClose: () => void }) {
  const { intents, paused, setPaused, revertLast } = useSelfJournal();
  const canRevert = intents.some((i) => i.status === "swapped");
  const shellRef = useGsapReveal([intents.length, paused]);
  const PauseIcon = paused ? Play : Pause;

  return (
    <div ref={shellRef} className="ava-luxe-screen ava-luxe-scroll text-white">
      <header data-gsap-reveal className="ava-luxe-header">
        <button
          onClick={onClose}
          aria-label="close"
          className="ava-icon-button shrink-0"
        >
          <ChevronLeft size={20} />
        </button>
        <div>
          <div className="ava-kicker mb-1">atelier journal</div>
          <div className="ava-luxe-title text-sm">Self-improvement</div>
        </div>
      </header>

      <main className="relative z-10 space-y-3 p-4">
        <section data-gsap-reveal className="ava-luxe-section">
          <div className="ava-section-label">Controls</div>
          <div className="flex gap-3">
            <button
              onClick={() => setPaused(!paused)}
              aria-pressed={paused}
              className="ava-secondary-button inline-flex items-center gap-2 px-3 py-1.5 text-xs"
            >
              <PauseIcon size={14} />
              {paused ? "Resume" : "Pause"}
            </button>
            <button
              onClick={revertLast}
              disabled={!canRevert}
              className="ava-secondary-button inline-flex items-center gap-2 px-3 py-1.5 text-xs disabled:opacity-40"
            >
              <RotateCcw size={14} />
              Revert last
            </button>
          </div>
          <div className="mt-2 text-[10px] text-[var(--ava-fg-faint)]">
            {paused
              ? "Paused. Ava will not act on self-improvements."
              : "Active. Ava may refine how it works for you."}
          </div>
        </section>

        <section data-gsap-reveal className="ava-luxe-section">
          <div className="ava-section-label">Journal</div>
          <ul className="space-y-2">
            {intents.length === 0 && (
              <li className="text-xs text-[var(--ava-fg-faint)]">no self-improvements yet.</li>
            )}
            {intents.map((i) => (
              <li
                key={i.id}
                className="ava-luxe-row px-3 py-2"
              >
                <div className="text-sm text-[var(--ava-fg)]">{i.goal}</div>
                <div className="mt-1 text-[10px] uppercase tracking-[0.2em] text-[var(--ava-fg-faint)]">
                  {i.status}
                  {i.outcome ? ` / ${i.outcome}` : ""}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
