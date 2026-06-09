import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Trash2, X } from "lucide-react";
import {
  fetchRules, createRule, patchRule, deleteRuleApi, type RuleRow,
  fetchReasoning, putReasoning, type ReasoningPref,
  fetchPinnedChips, createPinnedChip, deletePinnedChip, type ChipOverrideRow,
} from "../api.js";
import { getToken } from "../auth/tokens.js";
import { enablePush } from "../push/register.js";
import { SegmentedTabs } from "../components/ava/SegmentedTabs.js";
import { PanelShell, PanelSection } from "../components/ava/PanelShell.js";
import { useGSAP, gsap } from "../lib/gsap.js";
import { useReducedMotion } from "../lib/useReducedMotion.js";
import { hoverLift, press } from "../lib/deckMotion.js";

interface Device { id: string; label: string; created_at: number; revoked_at: number | null; }

type PushStatus = "unknown" | "granted" | "denied" | "default" | "unsupported" | "pending" | "error";

/** Map a rule's parse status to a state-chip class + label. */
function statusChip(status: string): { cls: string; label: string } | null {
  if (status === "pending") return { cls: "chip-exec", label: "PARSING" };
  if (status === "active") return { cls: "chip-live", label: "ACTIVE" };
  if (status === "failed") return { cls: "chip-stop", label: "PARSE FAILED" };
  return null;
}

export function RulesScreen(_props: { onClose?: () => void }) {
  const [rows, setRows] = useState<RuleRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [reason, setReason] = useState<ReasoningPref | null>(null);
  const [chips, setChips] = useState<ChipOverrideRow[]>([]);
  const [newChipLabel, setNewChipLabel] = useState("");
  const [newChipPrompt, setNewChipPrompt] = useState("");
  const [devices, setDevices] = useState<Device[]>([]);
  const [pushStatus, setPushStatus] = useState<PushStatus>("unknown");
  const [pushError, setPushError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const reduced = useReducedMotion();
  const scope = useRef<HTMLDivElement>(null);
  // Track the set of seen rule ids so we draw-on the underline of a GENUINELY new
  // rule (by id) — robust to the server re-sorting the list on refetch.
  const prevRuleIds = useRef<Set<string> | null>(null);

  async function refreshRules() {
    try {
      const r = await fetchRules();
      setRows(r);
      const anyPending = r.some((x) => x.status === "pending");
      if (anyPending && pollRef.current == null) {
        const started = Date.now();
        pollRef.current = window.setInterval(async () => {
          try {
            const r2 = await fetchRules();
            setRows(r2);
            const stillPending = r2.some((x) => x.status === "pending");
            if (!stillPending || Date.now() - started > 30_000) {
              if (pollRef.current != null) window.clearInterval(pollRef.current);
              pollRef.current = null;
            }
          } catch { /* best-effort */ }
        }, 2000);
      }
    } catch (e) {
      setErr(String(e));
    }
  }

  useEffect(() => {
    fetchReasoning().then(setReason).catch(() => {});
    fetchPinnedChips().then(setChips).catch(() => {});
    fetchDevices().then(setDevices).catch(() => {});
    refreshRules();
    if (typeof window === "undefined" || !("Notification" in window) || !("PushManager" in window) || !("serviceWorker" in navigator)) {
      setPushStatus("unsupported");
    } else {
      setPushStatus(Notification.permission as PushStatus);
    }
    return () => {
      if (pollRef.current != null) window.clearInterval(pollRef.current);
    };
  }, []);

  async function turnOnPush() {
    setPushStatus("pending");
    setPushError(null);
    const label = navigator.userAgent.includes("iPhone") ? "iPhone" : "Phone";
    const r = await enablePush(label);
    if (r.ok) {
      setPushStatus("granted");
    } else {
      setPushError(r.reason);
      setPushStatus("error");
    }
  }

  async function setReasoningLevel(level: "fast" | "thorough") {
    if (!reason) return;
    setReason({ ...reason, level });
    try { await putReasoning(level); }
    catch { fetchReasoning().then(setReason).catch(() => {}); }
  }

  async function addRule() {
    const text = draft.trim();
    if (!text) return;
    setAdding(true);
    try {
      await createRule(text);
      setDraft("");
      await refreshRules();
    } catch (e) {
      setErr(String(e));
    } finally {
      setAdding(false);
    }
  }

  async function toggleRule(rule: RuleRow) {
    await patchRule(rule.id, rule.enabled === 0);
    await refreshRules();
  }

  async function removeRule(rule: RuleRow) {
    await deleteRuleApi(rule.id);
    await refreshRules();
  }

  async function addChip() {
    if (!newChipLabel.trim() || !newChipPrompt.trim()) return;
    const c = await createPinnedChip({ label: newChipLabel.trim(), prompt: newChipPrompt.trim() });
    setChips((prev) => [...prev, c]);
    setNewChipLabel("");
    setNewChipPrompt("");
  }

  async function removeChip(id: string) {
    await deletePinnedChip(id);
    setChips((prev) => prev.filter((c) => c.id !== id));
  }

  async function revokeDevice(id: string) {
    const token = getToken() ?? "";
    await fetch(`/api/auth/devices/${id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    setDevices((prev) => prev.filter((d) => d.id !== id));
  }

  // Whether any rule is still parsing — drives the pending status-dot pulse.
  const anyPending = rows?.some((x) => x.status === "pending") ?? false;

  // ── Motion: pulse pending status dots, draw-on a newly-added rule's underline.
  const { contextSafe } = useGSAP(() => {
    const root = scope.current;
    if (!root || reduced || !rows) return;

    // Pulse the dots of any still-parsing rules (single low-cost yoyo, reduced-gated above).
    const pulsing = Array.from(root.querySelectorAll<HTMLElement>("[data-rule-pulse]"));
    if (pulsing.length) {
      gsap.to(pulsing, { opacity: 0.4, repeat: -1, yoyo: true, duration: 0.8, ease: "sine.inOut" });
    }

    // Draw the cyan underline of any rule whose id we haven't seen before (so the
    // glint lands on the actually-new row, not just whatever sorts last).
    const ids = new Set(rows.map((r) => r.id));
    const prev = prevRuleIds.current;
    if (prev) {
      for (const r of rows) {
        if (prev.has(r.id)) continue;
        const ln = root.querySelector<SVGLineElement>(`[data-rule-underline][data-rule-id="${r.id}"]`);
        if (ln) gsap.fromTo(ln, { drawSVG: "0%" }, { drawSVG: "100%", duration: 0.6, ease: "power2.out" });
      }
    }
    prevRuleIds.current = ids;
  }, { scope, dependencies: [rows, reduced, anyPending] });

  const onEnter = contextSafe((e: React.MouseEvent<HTMLElement>) => hoverLift(e.currentTarget, true, reduced));
  const onLeave = contextSafe((e: React.MouseEvent<HTMLElement>) => hoverLift(e.currentTarget, false, reduced));
  const onDown = contextSafe((e: React.MouseEvent<HTMLElement>) => press(e.currentTarget, true, reduced));
  const onUp = contextSafe((e: React.MouseEvent<HTMLElement>) => press(e.currentTarget, false, reduced));

  return (
    <div ref={scope} className="h-full">
      <PanelShell title="Rules" grid>
        <PanelSection title="Speed" span="lg:col-span-4">
          {reason ? (
            <>
              <SegmentedTabs<"fast" | "thorough">
                options={[
                  { value: "fast", label: "Fast", hint: "snappy voice · instant" },
                  { value: "thorough", label: "Thorough", hint: "patient voice · deeper" },
                ]}
                value={reason.level}
                onChange={(lvl) => setReasoningLevel(lvl)}
                layout="full"
              />
              <div className="text-[10px] text-white/40 mt-3 leading-relaxed">
                Tunes both <b className="text-white/60">voice responsiveness</b> (how fast Ava jumps in) and{" "}
                <b className="text-white/60">chat reasoning depth</b>.
                {reason.supported === false && " (Reasoning depth needs the OpenAI provider; voice speed always applies.)"}
              </div>
            </>
          ) : (
            <div className="text-xs text-white/40">Loading…</div>
          )}
        </PanelSection>

        <PanelSection title="Notifications" span="lg:col-span-4">
          {pushStatus === "unsupported" && (
            <div className="text-xs text-white/40 leading-relaxed">Push notifications aren't supported in this browser.</div>
          )}
          {pushStatus === "granted" && (
            <div className="chip chip-live">ENABLED</div>
          )}
          {pushStatus === "granted" && (
            <div className="text-[11px] text-white/55 mt-3 leading-relaxed">
              Ava can send approval prompts to this device.
            </div>
          )}
          {pushStatus === "denied" && (
            <div className="text-xs text-white/40 leading-relaxed">
              Browser blocked notifications. Re-enable in your browser site settings, then reload.
            </div>
          )}
          {(pushStatus === "default" || pushStatus === "error" || pushStatus === "unknown") && (
            <div className="space-y-3">
              <div className="text-[11px] text-white/55 leading-relaxed">Get push prompts when Ava needs your approval — even when the app is closed.</div>
              <button
                onClick={turnOnPush}
                onMouseDown={onDown}
                onMouseUp={onUp}
                onMouseLeave={onUp}
                className="btn-deck btn-primary"
              >
                Enable notifications
              </button>
              {pushError && <div className="text-xs text-[var(--ac-stop)]">{pushError}</div>}
            </div>
          )}
          {pushStatus === "pending" && (
            <div className="text-xs text-white/55">Asking permission…</div>
          )}
        </PanelSection>

        <PanelSection title="Devices" span="lg:col-span-4">
          <div className="space-y-2">
            {devices.length === 0 && <div className="text-xs text-white/40">no devices paired.</div>}
            {devices.map((d) => (
              <div
                key={d.id}
                onMouseEnter={onEnter}
                onMouseLeave={onLeave}
                className="lg-slab lg-sweep rounded-xl px-3 py-2.5 text-xs flex items-center gap-3"
                style={{ "--sweep-x": "-130%" } as CSSProperties}
              >
                <span className="font-medium text-white/90">{d.label}</span>
                <span className="hud text-[10px] text-white/40">{new Date(d.created_at).toLocaleDateString()}</span>
                <button
                  className="btn-deck btn-danger ml-auto !h-7 !px-2"
                  aria-label="revoke"
                  onClick={() => revokeDevice(d.id)}
                  onMouseDown={onDown}
                  onMouseUp={onUp}
                >
                  <Trash2 size={13} aria-hidden /> revoke
                </button>
              </div>
            ))}
          </div>
        </PanelSection>

        <PanelSection title="Autonomy rules" span="lg:col-span-12">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="e.g. never let shell delete files in C:/work without asking"
            className="w-full bg-white/[0.02] border border-white/10 rounded-lg px-3 py-2.5 text-xs h-20 placeholder:text-white/35 mb-3 focus:border-[rgba(92,242,255,0.4)] focus:outline-none transition-colors"
          />
          <button
            onClick={addRule}
            disabled={adding || !draft.trim()}
            onMouseDown={onDown}
            onMouseUp={onUp}
            onMouseLeave={onUp}
            className="btn-deck btn-primary"
          >
            {adding ? "adding…" : "Add rule"}
          </button>
          <div className="space-y-2 mt-4">
            {err && <div className="text-xs text-[var(--ac-stop)]">error: {err}</div>}
            {!rows && !err && <div className="text-xs text-white/40">loading…</div>}
            {rows?.length === 0 && <div className="text-xs text-white/40">no rules yet.</div>}
            {rows?.map((r) => {
              const chip = statusChip(r.status);
              return (
                <div
                  key={r.id}
                  onMouseEnter={onEnter}
                  onMouseLeave={onLeave}
                  className="lg-slab lg-sweep relative rounded-xl px-4 py-3 text-xs flex items-start gap-3"
                  style={{ "--sweep-x": "-130%" } as CSSProperties}
                >
                  <button
                    type="button"
                    role="switch"
                    aria-checked={r.enabled === 1}
                    aria-label="enabled"
                    data-on={r.enabled === 1 ? "true" : "false"}
                    onClick={() => toggleRule(r)}
                    className="tgl mt-0.5 shrink-0"
                  >
                    <span className="tgl-knob" />
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="whitespace-pre-wrap break-words text-white/85 leading-relaxed">{r.source}</div>
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      {chip && (
                        <span className={"chip " + chip.cls} data-rule-pulse={r.status === "pending" ? "" : undefined}>
                          {chip.label}
                        </span>
                      )}
                      <span className="hud text-[10px] text-white/40">{new Date(r.created_at).toLocaleString()}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => removeRule(r)}
                    aria-label="delete"
                    onMouseDown={onDown}
                    onMouseUp={onUp}
                    className="btn-deck btn-danger !h-7 !w-7 !px-0 justify-center shrink-0"
                  >
                    <X size={14} aria-hidden />
                  </button>
                  {/* draw-on cyan underline accent for a newly-added rule */}
                  <svg
                    className="pointer-events-none absolute bottom-0 left-4 right-4 overflow-visible"
                    height="1.5"
                    aria-hidden
                  >
                    <line
                      data-rule-underline
                      data-rule-id={r.id}
                      x1="0" y1="0.75" x2="100%" y2="0.75"
                      stroke="var(--ac)" strokeWidth="1.5" strokeLinecap="round"
                      style={{ opacity: 0.35 }}
                    />
                  </svg>
                </div>
              );
            })}
          </div>
        </PanelSection>

        <PanelSection title="Pinned chips" span="lg:col-span-12">
          <div className="space-y-2 mb-3">
            {chips.length === 0 && <div className="text-xs text-white/40">no pinned chips.</div>}
            {chips.map((c) => (
              <div
                key={c.id}
                onMouseEnter={onEnter}
                onMouseLeave={onLeave}
                className="lg-slab lg-sweep rounded-xl px-4 py-2.5 text-xs flex items-center gap-3"
                style={{ "--sweep-x": "-130%" } as CSSProperties}
              >
                <span className="font-medium text-white/90">{c.label}</span>
                <span className="text-white/55 truncate flex-1">{c.prompt}</span>
                <button
                  className="btn-deck btn-danger !h-7 !w-7 !px-0 justify-center shrink-0"
                  aria-label="delete"
                  onClick={() => removeChip(c.id)}
                  onMouseDown={onDown}
                  onMouseUp={onUp}
                >
                  <X size={14} aria-hidden />
                </button>
              </div>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={newChipLabel}
              onChange={(e) => setNewChipLabel(e.target.value)}
              placeholder="Label"
              className="sm:w-40 h-9 bg-white/[0.02] border border-white/10 rounded-lg px-3 text-xs placeholder:text-white/35 focus:border-[rgba(92,242,255,0.4)] focus:outline-none transition-colors"
            />
            <input
              value={newChipPrompt}
              onChange={(e) => setNewChipPrompt(e.target.value)}
              placeholder="Prompt"
              className="flex-1 h-9 bg-white/[0.02] border border-white/10 rounded-lg px-3 text-xs placeholder:text-white/35 focus:border-[rgba(92,242,255,0.4)] focus:outline-none transition-colors"
            />
            <button
              onClick={addChip}
              onMouseDown={onDown}
              onMouseUp={onUp}
              onMouseLeave={onUp}
              className="btn-deck btn-primary shrink-0"
            >
              Add chip
            </button>
          </div>
        </PanelSection>
      </PanelShell>
    </div>
  );
}

async function fetchDevices(): Promise<Device[]> {
  const token = getToken() ?? "";
  const r = await fetch("/api/auth/devices", { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) return [];
  const j = (await r.json()) as { devices: Device[] };
  return j.devices;
}
