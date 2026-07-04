import { useEffect, useState, type CSSProperties } from "react";
import { fetchPeople, type PersonRow } from "../api.js";
import { PanelSection } from "../components/ava/PanelShell.js";
import { useGSAP } from "../lib/gsap.js";
import { useReducedMotion } from "../lib/useReducedMotion.js";
import { hoverLift } from "../lib/deckMotion.js";

/** Light refresh so identities Ava just learned show up without a reload. */
const REFRESH_MS = 30_000;

/**
 * "People" — the read surface over Ava's people map (GET /api/people). Shows WHO
 * Ava knows how to reach: name + aliases, per-app identity chips (IG / WA) and a
 * small ✓ badge when the Instagram DM thread is already learned (instant sends).
 * Read-only by design: the map is grown conversationally, not edited here.
 */
export function PeopleSection() {
  const [rows, setRows] = useState<PersonRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetchPeople();
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
      title="People"
      span="lg:col-span-12"
      right={rows && rows.length > 0 ? <span className="chip chip-ac">{rows.length}</span> : undefined}
    >
      <div className="space-y-2">
        {err && <div className="text-xs text-[var(--ac-stop)]">error: {err}</div>}
        {!rows && !err && <div className="text-xs text-white/40">loading…</div>}
        {rows?.length === 0 && (
          <div className="text-xs text-white/40">
            {"No people yet — tell Ava who your people are ('remember that Lasha is weird_username_123 on Instagram')."}
          </div>
        )}
        {rows?.map((p) => (
          <PersonCard key={p.id} person={p} />
        ))}
      </div>
    </PanelSection>
  );
}

/**
 * One person row: name (title) + aliases as quiet inline text; app identity
 * chips ("IG @username" with a ✓ instant badge when the DM thread id is known,
 * "WA <name or phone>"); a notes line when present. Renders defensively — the
 * map is hand-grown JSON, so any field may be missing without crashing the panel.
 */
function PersonCard({ person: p }: { person: PersonRow }) {
  const reduced = useReducedMotion();
  const { contextSafe } = useGSAP();

  const aliases = (Array.isArray(p.aliases) ? p.aliases : []).filter(
    (a) => typeof a === "string" && a.trim(),
  );
  const ig = p.instagram ?? undefined;
  const waLabel = String(p.whatsapp?.username || p.whatsapp?.phone || "").trim();
  const showIg = Boolean(ig && (ig.username || ig.threadId));

  return (
    <div
      className="lg-slab lg-sweep relative rounded-xl px-4 py-3 text-xs"
      style={{ "--sweep-x": "-130%" } as CSSProperties}
      onMouseEnter={contextSafe((e: React.MouseEvent<HTMLDivElement>) => hoverLift(e.currentTarget, true, reduced))}
      onMouseLeave={contextSafe((e: React.MouseEvent<HTMLDivElement>) => hoverLift(e.currentTarget, false, reduced))}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-[13px] font-medium leading-snug text-white/90">
          {String(p.name ?? "") || "(unnamed)"}
        </span>
        {aliases.length > 0 && (
          <span className="text-[11px] text-white/40">aka {aliases.join(", ")}</span>
        )}
        {p.updated && (
          <span className="hud ml-auto text-[9px] tracking-[0.16em] text-white/30">
            {String(p.updated)}
          </span>
        )}
      </div>

      {(showIg || waLabel) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {showIg && (
            <span className="hud inline-flex items-center gap-1.5 rounded-full border border-white/10 px-2 py-0.5 text-[9px] tracking-[0.16em] text-white/55">
              {ig?.username ? `IG @${ig.username}` : "IG"}
              {ig?.threadId && (
                <span
                  className="text-[var(--ac)]"
                  title="DM thread known — instant send"
                  aria-label="instant"
                >
                  ✓
                </span>
              )}
            </span>
          )}
          {waLabel && (
            <span className="hud inline-flex items-center rounded-full border border-white/10 px-2 py-0.5 text-[9px] tracking-[0.16em] text-white/55">
              {`WA ${waLabel}`}
            </span>
          )}
        </div>
      )}

      {typeof p.notes === "string" && p.notes.trim() && (
        <div className="mt-1.5 text-[11px] leading-relaxed text-white/55">{p.notes}</div>
      )}
    </div>
  );
}
