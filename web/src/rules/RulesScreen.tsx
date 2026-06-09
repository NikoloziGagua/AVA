import { useEffect, useRef, useState } from "react";
import {
  fetchRules, createRule, patchRule, deleteRuleApi, type RuleRow,
  fetchReasoning, putReasoning, type ReasoningPref,
  fetchPinnedChips, createPinnedChip, deletePinnedChip, type ChipOverrideRow,
} from "../api.js";
import { getToken } from "../auth/tokens.js";
import { enablePush } from "../push/register.js";
import { SegmentedTabs } from "../components/ava/SegmentedTabs.js";
import { PanelShell, PanelSection } from "../components/ava/PanelShell.js";

interface Device { id: string; label: string; created_at: number; revoked_at: number | null; }

type PushStatus = "unknown" | "granted" | "denied" | "default" | "unsupported" | "pending" | "error";

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
    <PanelShell title="Rules">
      <PanelSection title="Speed">
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
            <div className="text-[10px] text-white/40 mt-2">
              Tunes both <b className="text-white/60">voice responsiveness</b> (how fast Ava jumps in) and{" "}
              <b className="text-white/60">chat reasoning depth</b>.
              {reason.supported === false && " (Reasoning depth needs the OpenAI provider; voice speed always applies.)"}
            </div>
          </>
        ) : (
          <div className="text-xs text-white/40">Loading…</div>
        )}
      </PanelSection>

      <PanelSection title="Autonomy rules">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. never let shell delete files in C:/work without asking"
          className="w-full bg-transparent border border-white/10 rounded-md px-2 py-1.5 text-xs h-20 placeholder:text-white/35 mb-2"
        />
        <button
          onClick={addRule}
          disabled={adding || !draft.trim()}
          className="px-3 py-1 text-xs rounded-md disabled:opacity-50"
          style={{ background: "var(--ac)", color: "#04222a" }}
        >
          {adding ? "adding…" : "Add rule"}
        </button>
        <div className="space-y-1.5 mt-3">
          {err && <div className="text-xs text-red-400">error: {err}</div>}
          {!rows && !err && <div className="text-xs text-white/40">loading…</div>}
          {rows?.length === 0 && <div className="text-xs text-white/40">no rules yet.</div>}
          {rows?.map((r) => (
            <div key={r.id} className="border border-white/8 rounded-md px-3 py-2 text-xs flex items-start gap-3 hover:border-[rgba(92,242,255,0.3)] transition-colors">
              <input
                type="checkbox"
                checked={r.enabled === 1}
                onChange={() => toggleRule(r)}
                aria-label="enabled"
                className="mt-0.5 accent-white"
              />
              <div className="flex-1 min-w-0">
                <div className="whitespace-pre-wrap break-words text-white/85">{r.source}</div>
                <div className="text-[10px] text-white/40 mt-1">
                  {r.status === "pending" && <span className="text-yellow-400">parsing…</span>}
                  {r.status === "active" && <span className="text-emerald-400">active</span>}
                  {r.status === "failed" && <span className="text-red-400">parse failed</span>}
                  <span className="ml-2">{new Date(r.created_at).toLocaleString()}</span>
                </div>
              </div>
              <button onClick={() => removeRule(r)} aria-label="delete" className="text-white/45 hover:text-red-400">×</button>
            </div>
          ))}
        </div>
      </PanelSection>

      <PanelSection title="Pinned chips">
        <div className="space-y-1.5 mb-2">
          {chips.length === 0 && <div className="text-xs text-white/40">no pinned chips.</div>}
          {chips.map((c) => (
            <div key={c.id} className="border border-white/8 rounded-md px-3 py-2 text-xs flex items-center gap-3 hover:border-[rgba(92,242,255,0.3)] transition-colors">
              <span className="font-medium">{c.label}</span>
              <span className="text-white/55 truncate flex-1">{c.prompt}</span>
              <button className="text-red-400" onClick={() => removeChip(c.id)}>delete</button>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <input
            value={newChipLabel}
            onChange={(e) => setNewChipLabel(e.target.value)}
            placeholder="Label"
            className="bg-transparent border border-white/10 rounded-md px-2 py-1.5 text-xs placeholder:text-white/35"
          />
          <input
            value={newChipPrompt}
            onChange={(e) => setNewChipPrompt(e.target.value)}
            placeholder="Prompt"
            className="col-span-2 bg-transparent border border-white/10 rounded-md px-2 py-1.5 text-xs placeholder:text-white/35"
          />
        </div>
        <button onClick={addChip} className="mt-2 px-3 py-1 text-xs rounded-md" style={{ background: "var(--ac)", color: "#04222a" }}>Add chip</button>
      </PanelSection>

      <PanelSection title="Notifications">
        {pushStatus === "unsupported" && (
          <div className="text-xs text-white/40">Push notifications aren't supported in this browser.</div>
        )}
        {pushStatus === "granted" && (
          <div className="flex items-center gap-2 text-xs text-emerald-300">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
            Enabled — Ava can send approval prompts to this device.
          </div>
        )}
        {pushStatus === "denied" && (
          <div className="text-xs text-white/40">
            Browser blocked notifications. Re-enable in your browser site settings, then reload.
          </div>
        )}
        {(pushStatus === "default" || pushStatus === "error" || pushStatus === "unknown") && (
          <div className="space-y-2">
            <div className="text-xs text-white/55">Get push prompts when Ava needs your approval — even when the app is closed.</div>
            <button
              onClick={turnOnPush}
              className="px-3 py-1.5 text-xs rounded-md"
              style={{ background: "var(--ac)", color: "#04222a" }}
            >
              Enable notifications
            </button>
            {pushError && <div className="text-xs text-red-400">{pushError}</div>}
          </div>
        )}
        {pushStatus === "pending" && (
          <div className="text-xs text-white/55">Asking permission…</div>
        )}
      </PanelSection>

      <PanelSection title="Devices">
        <div className="space-y-1.5">
          {devices.length === 0 && <div className="text-xs text-white/40">no devices paired.</div>}
          {devices.map((d) => (
            <div key={d.id} className="border border-white/8 rounded-md px-3 py-2 text-xs flex items-center gap-3 hover:border-[rgba(92,242,255,0.3)] transition-colors">
              <span className="font-medium">{d.label}</span>
              <span className="text-white/45">{new Date(d.created_at).toLocaleDateString()}</span>
              <button className="ml-auto text-red-400" onClick={() => revokeDevice(d.id)}>revoke</button>
            </div>
          ))}
        </div>
      </PanelSection>
    </PanelShell>
  );
}

async function fetchDevices(): Promise<Device[]> {
  const token = getToken() ?? "";
  const r = await fetch("/api/auth/devices", { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) return [];
  const j = (await r.json()) as { devices: Device[] };
  return j.devices;
}
