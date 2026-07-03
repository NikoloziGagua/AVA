import { useEffect, useRef, useState } from "react";
import { fetchPlaybooks, type PlaybookRow } from "../api.js";
import { PanelSection } from "../components/ava/PanelShell.js";
import { useGSAP, gsap } from "../lib/gsap.js";
import { useReducedMotion } from "../lib/useReducedMotion.js";
import { EASE } from "../lib/deckMotion.js";

// Closed (▸) and open (▾) chevron paths — same MorphSVG disclosure as the
// Projects section, so the two read surfaces feel like one instrument.
const CHEVRON_CLOSED = "M5 3 L11 8 L5 13";
const CHEVRON_OPEN = "M3 5 L8 11 L13 5";

/** Light refresh so a playbook Ava just distilled shows up without a reload. */
const REFRESH_MS = 30_000;

/** "v3 · used 12× · 10W/2L · ~42s" — one playbook's optimization vitals. */
export function playbookStatLine(pb: PlaybookRow): string {
  const version = Number(pb.version) || 1;
  const uses = Number(pb.uses) || 0;
  const succ = Number(pb.succ) || 0;
  const fail = Number(pb.fail) || 0;
  const avg = Math.round(Number(pb.avg_secs) || 0);
  return `v${version} · used ${uses}× · ${succ}W/${fail}L · ~${avg}s`;
}

/**
 * "Learned workflows" — the read surface over Ava's playbooks (GET /api/playbooks).
 * Shows WHAT Ava has learned from repeated multi-step tasks and whether each
 * procedure is actually working (uses, win/loss record, average duration, lessons).
 * Read-only by design: playbooks are grown conversationally, not edited here.
 */
export function PlaybooksSection() {
  const [rows, setRows] = useState<PlaybookRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetchPlaybooks();
        if (!alive) return;
        setRows(r);
        setErr(null);
      } catch (e) {
        if (alive) setErr(String(e));
      }
    };
    void load();
    const t = window.setInterval(() => void load(), REFRESH_MS);
    return () => { alive = false; window.clearInterval(t); };
  }, []);

  return (
    <PanelSection
      title="Learned workflows"
      span="lg:col-span-6"
      right={rows && rows.length > 0 ? <span className="chip chip-ac">{rows.length}</span> : undefined}
    >
      <div className="space-y-2">
        {err && <div className="text-xs text-[var(--ac-stop)]">error: {err}</div>}
        {!rows && !err && <div className="text-xs text-white/40">loading…</div>}
        {rows?.length === 0 && (
          <div className="text-xs text-white/40">
            Nothing learned yet — playbooks appear after successful multi-step tasks.
          </div>
        )}
        {rows?.map((pb) => (
          <PlaybookDisclosure key={pb.slug} pb={pb} />
        ))}
      </div>
    </PanelSection>
  );
}

/**
 * One playbook row: trigger (title) + stat row collapsed; steps (numbered) and
 * lessons (amber advice) on expand. Chevron morphs ▸↔▾ like ProjectDisclosure.
 */
function PlaybookDisclosure({ pb }: { pb: PlaybookRow }) {
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const chevronRef = useRef<SVGPathElement>(null);
  // Defensive: old/partial playbook files may miss the array fields entirely.
  const steps = Array.isArray(pb.steps) ? pb.steps : [];
  const lessons = Array.isArray(pb.lessons) ? pb.lessons : [];
  const consequential = pb.stakes === "consequential";

  useGSAP(() => {
    const path = chevronRef.current;
    if (!path) return;
    const target = open ? CHEVRON_OPEN : CHEVRON_CLOSED;
    if (reduced) { gsap.set(path, { attr: { d: target } }); return; }
    gsap.to(path, { duration: 0.4, ease: EASE, morphSVG: target });
  }, { dependencies: [open, reduced] });

  return (
    <div className="lg-slab overflow-hidden rounded-xl">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-2 px-3 py-2.5 text-left text-xs text-white/85 transition-colors hover:text-white"
        aria-expanded={open}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" className="mt-0.5 shrink-0 text-[var(--ac)]" aria-hidden>
          <path
            ref={chevronRef}
            d={CHEVRON_CLOSED}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 truncate">{pb.trigger}</span>
            {consequential ? (
              <span className="chip chip-exec">CONSEQUENTIAL</span>
            ) : (
              <span className="hud rounded-full border border-white/10 px-2 py-0.5 text-[9px] tracking-[0.16em] text-white/40">
                {typeof pb.stakes === "string" && pb.stakes ? pb.stakes : "routine"}
              </span>
            )}
          </span>
          <span className="mt-1 block hud text-[9px] tracking-[0.16em] text-white/35">
            {playbookStatLine(pb)}
          </span>
        </span>
      </button>
      {open && (
        <div className="mb-3 ml-[1.85rem] mr-3 space-y-3">
          <ol className="space-y-1.5 border-l border-[rgba(92,242,255,0.25)] pl-3">
            {steps.length === 0 && (
              <li className="text-[11px] text-white/40">(no steps recorded)</li>
            )}
            {steps.map((s, i) => (
              <li key={i} className="flex gap-2 text-[11px] leading-relaxed text-white/70">
                <span className="hud mt-0.5 shrink-0 text-[9px] tracking-[0.16em] text-[var(--ac)]/70">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0">{String(s)}</span>
              </li>
            ))}
          </ol>
          {lessons.length > 0 && (
            <div className="border-l border-[rgba(255,212,121,0.35)] pl-3">
              <div className="hud mb-1 text-[9px] tracking-[0.18em] text-[var(--ac-exec)]/85">lessons</div>
              <div className="space-y-1">
                {lessons.map((l, i) => (
                  <div key={i} className="text-[11px] italic leading-relaxed text-white/60">
                    {String(l)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
