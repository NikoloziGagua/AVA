import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bell, ChevronLeft, Smartphone, Trash2 } from "lucide-react";
import {
  fetchRules, createRule, patchRule, deleteRuleApi, type RuleRow,
  fetchReasoning, putReasoning, type ReasoningPref,
  fetchPinnedChips, createPinnedChip, deletePinnedChip, type ChipOverrideRow,
} from "../api.js";
import { getToken } from "../auth/tokens.js";
import { enablePush } from "../push/register.js";
import { SegmentedTabs } from "../components/ava/SegmentedTabs.js";
import { useGsapReveal } from "../lib/useGsapReveal.js";

interface Device { id: string; label: string; created_at: number; revoked_at: number | null; }

type PushStatus = "unknown" | "granted" | "denied" | "default" | "unsupported" | "pending" | "error";

export function RulesScreen({ onClose }: { onClose: () => void }) {
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
  const shellRef = useGsapReveal([rows?.length ?? 0, chips.length, devices.length, pushStatus]);

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

  return (
    <div ref={shellRef} className="ava-luxe-screen ava-luxe-scroll text-white">
      <header data-gsap-reveal className="ava-luxe-header">
        <button
          onClick={onClose}
          aria-label="back"
          className="ava-icon-button shrink-0"
        >
          <ChevronLeft size={20} />
        </button>
        <div>
          <div className="ava-kicker mb-1">governance</div>
          <div className="ava-luxe-title text-sm">Rules</div>
        </div>
      </header>

      <main className="relative z-10 space-y-3 p-4">
        <Section title="Reasoning">
          {reason ? (
            <>
              <SegmentedTabs<"fast" | "thorough">
                options={[
                  { value: "fast", label: "Fast", hint: "instant / light" },
                  { value: "thorough", label: "Thorough", hint: "slower / deeper" },
                ]}
                value={reason.level}
                onChange={(lvl) => reason.supported !== false && setReasoningLevel(lvl)}
                layout="full"
              />
              {reason.supported === false && (
                <div className="mt-2 text-[10px] text-[var(--ava-fg-faint)]">Available with OpenAI provider only.</div>
              )}
            </>
          ) : (
            <div className="text-xs text-[var(--ava-fg-faint)]">Loading...</div>
          )}
        </Section>

        <Section title="Autonomy rules">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="e.g. never let shell delete files in C:/work without asking"
            className="ava-luxe-field mb-2 h-20 w-full px-2 py-1.5 text-xs"
          />
          <button
            onClick={addRule}
            disabled={adding || !draft.trim()}
            className="ava-primary-button px-3 py-1 text-xs disabled:opacity-50"
          >
            {adding ? "adding..." : "Add rule"}
          </button>
          <div className="mt-3 space-y-2">
            {err && <div className="text-xs text-red-400">error: {err}</div>}
            {!rows && !err && <div className="text-xs text-[var(--ava-fg-faint)]">loading...</div>}
            {rows?.length === 0 && <div className="text-xs text-[var(--ava-fg-faint)]">no rules yet.</div>}
            {rows?.map((r) => (
              <div key={r.id} className="ava-luxe-row flex items-start gap-3 px-3 py-2 text-xs">
                <input
                  type="checkbox"
                  checked={r.enabled === 1}
                  onChange={() => toggleRule(r)}
                  aria-label="enabled"
                  className="mt-0.5"
                  style={{ accentColor: "var(--ava-champagne)" }}
                />
                <div className="min-w-0 flex-1">
                  <div className="whitespace-pre-wrap break-words text-[var(--ava-fg)]">{r.source}</div>
                  <div className="mt-1 text-[10px] text-[var(--ava-fg-faint)]">
                    {r.status === "pending" && <span className="text-[var(--ava-gold)]">parsing...</span>}
                    {r.status === "active" && <span className="text-[var(--ava-jade)]">active</span>}
                    {r.status === "failed" && <span className="text-red-400">parse failed</span>}
                    <span className="ml-2">{new Date(r.created_at).toLocaleString()}</span>
                  </div>
                </div>
                <button onClick={() => removeRule(r)} aria-label="delete" className="text-[var(--ava-fg-faint)] hover:text-red-400">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Pinned chips">
          <div className="mb-2 space-y-2">
            {chips.length === 0 && <div className="text-xs text-[var(--ava-fg-faint)]">no pinned chips.</div>}
            {chips.map((c) => (
              <div key={c.id} className="ava-luxe-row flex items-center gap-3 px-3 py-2 text-xs">
                <span className="font-medium text-[var(--ava-ink)]">{c.label}</span>
                <span className="flex-1 truncate text-[var(--ava-fg-muted)]">{c.prompt}</span>
                <button className="text-red-400" onClick={() => removeChip(c.id)}>delete</button>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <input
              value={newChipLabel}
              onChange={(e) => setNewChipLabel(e.target.value)}
              placeholder="Label"
              className="ava-luxe-field px-2 py-1.5 text-xs"
            />
            <input
              value={newChipPrompt}
              onChange={(e) => setNewChipPrompt(e.target.value)}
              placeholder="Prompt"
              className="ava-luxe-field col-span-2 px-2 py-1.5 text-xs"
            />
          </div>
          <button onClick={addChip} className="ava-primary-button mt-2 px-3 py-1 text-xs">Add chip</button>
        </Section>

        <Section title="Notifications">
          {pushStatus === "unsupported" && (
            <div className="text-xs text-[var(--ava-fg-faint)]">Push notifications are not supported in this browser.</div>
          )}
          {pushStatus === "granted" && (
            <div className="flex items-center gap-2 text-xs text-[var(--ava-jade)]">
              <Bell size={14} />
              Enabled. Ava can send approval prompts to this device.
            </div>
          )}
          {pushStatus === "denied" && (
            <div className="text-xs text-[var(--ava-fg-faint)]">
              Browser blocked notifications. Re-enable in your browser site settings, then reload.
            </div>
          )}
          {(pushStatus === "default" || pushStatus === "error" || pushStatus === "unknown") && (
            <div className="space-y-2">
              <div className="text-xs text-[var(--ava-fg-muted)]">Get push prompts when Ava needs your approval, even when the app is closed.</div>
              <button
                onClick={turnOnPush}
                className="ava-primary-button px-3 py-1.5 text-xs"
              >
                Enable notifications
              </button>
              {pushError && <div className="text-xs text-red-400">{pushError}</div>}
            </div>
          )}
          {pushStatus === "pending" && (
            <div className="text-xs text-[var(--ava-fg-muted)]">Asking permission...</div>
          )}
        </Section>

        <Section title="Devices">
          <div className="space-y-2">
            {devices.length === 0 && <div className="text-xs text-[var(--ava-fg-faint)]">no devices paired.</div>}
            {devices.map((d) => (
              <div key={d.id} className="ava-luxe-row flex items-center gap-3 px-3 py-2 text-xs">
                <Smartphone size={14} className="text-[var(--ava-champagne)]" />
                <span className="font-medium text-[var(--ava-ink)]">{d.label}</span>
                <span className="text-[var(--ava-fg-faint)]">{new Date(d.created_at).toLocaleDateString()}</span>
                <button className="ml-auto text-red-400" onClick={() => revokeDevice(d.id)}>revoke</button>
              </div>
            ))}
          </div>
        </Section>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section data-gsap-reveal className="ava-luxe-section">
      <div className="ava-section-label">{title}</div>
      {children}
    </section>
  );
}

async function fetchDevices(): Promise<Device[]> {
  const token = getToken() ?? "";
  const r = await fetch("/api/auth/devices", { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) return [];
  const j = (await r.json()) as { devices: Device[] };
  return j.devices;
}
