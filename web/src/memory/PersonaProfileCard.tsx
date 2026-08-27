import { CheckCircle2, FlaskConical, Layers3 } from "lucide-react";
import type { MemoryView } from "../api.js";

export function PersonaProfileCard({ profile }: { profile: MemoryView["personaProfile"] }) {
  return (
    <section
      aria-label={`AVA Persona version ${profile.version}`}
      className="rounded-xl border border-[rgba(92,242,255,0.2)] bg-[rgba(92,242,255,0.045)] p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Layers3 size={15} aria-hidden className="text-[var(--ac)]" />
            <h3 className="hud text-[11px] tracking-[0.18em] text-white/85">AVA PERSONA</h3>
            <span className="rounded-full border border-[rgba(92,242,255,0.28)] px-2 py-0.5 text-[9px] font-medium tracking-[0.12em] text-[var(--ac)]">
              V{profile.version}
            </span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-white/55">
            One stable identity, with delivery matched to the moment. Chat and voice use the same AVA.
          </p>
        </div>
        <div
          className={
            "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] tracking-[0.1em] " +
            (profile.lab.valid
              ? "border-emerald-300/20 bg-emerald-300/[0.07] text-emerald-200"
              : "border-amber-300/25 bg-amber-300/[0.07] text-amber-200")
          }
          aria-label={profile.lab.valid ? "Persona contract valid" : "Persona contract has errors"}
        >
          <CheckCircle2 size={11} aria-hidden />
          {profile.lab.valid ? "CONTRACT VALID" : "CHECK REQUIRED"}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {profile.registers.map((register) => (
          <div key={register.id} className="rounded-lg border border-white/[0.07] bg-black/25 px-3 py-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/75">
              {register.label}
            </div>
            <div className="mt-1 text-[11px] leading-relaxed text-white/40">{register.summary}</div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2.5">
        <FlaskConical size={14} aria-hidden className="mt-0.5 shrink-0 text-purple-200/80" />
        <div>
          <div className="text-[10px] font-medium tracking-[0.1em] text-white/65">
            {profile.lab.scenarioCount} CONSISTENCY SCENARIOS / CHAT + VOICE
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-white/35">{profile.lab.caveat}</p>
        </div>
      </div>
    </section>
  );
}
