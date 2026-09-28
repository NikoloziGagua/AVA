import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../api.js";
import { PanelSection } from "../components/ava/PanelShell.js";
import { fetchNotesTree, type NoteFolder } from "../notes/api.js";
import {
  fetchInitiativeSettings,
  patchInitiativeSettings,
  type InitiativeSettings,
  type SettingsPatch,
} from "./api.js";

const LOCAL_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Settings for AVA's ideas (contract ava-initiative). Every change carries the
 * version it was based on; a change made elsewhere is shown, never overwritten.
 * An AVA without this feature (404) shows nothing at all.
 */
export function IdeasSettingsSection() {
  const [settings, setSettings] = useState<InitiativeSettings | null>(null);
  const [folders, setFolders] = useState<NoteFolder[] | null>(null);
  const [absent, setAbsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setSettings(await fetchInitiativeSettings());
      setLoadFailed(false);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) setAbsent(true);
      else setLoadFailed(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    let alive = true;
    fetchNotesTree()
      .then((tree) => { if (alive) setFolders(tree.folders.filter((folder) => !folder.builtIn)); })
      .catch(() => { if (alive) setFolders([]); });
    return () => { alive = false; };
  }, []);

  const save = async (patch: SettingsPatch) => {
    if (!settings || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await patchInitiativeSettings(patch, settings.version);
      if (result.ok) {
        setSettings(result.settings);
      } else {
        setMessage("These settings changed elsewhere. Showing the latest.");
        await load();
      }
    } catch {
      setMessage("That didn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const saveTime = (field: "deliveryLocalTime" | "quietStart" | "quietEnd", value: string) => {
    if (!settings || value === settings[field]) return;
    if (!LOCAL_TIME.test(value)) { setMessage("Use a time like 11:00."); return; }
    const patch: SettingsPatch = {};
    patch[field] = value;
    void save(patch);
  };

  const toggleFolder = (id: string) => {
    if (!settings) return;
    const current = settings.activeProjectFolderIds;
    void save({ activeProjectFolderIds: current.includes(id) ? current.filter((value) => value !== id) : [...current, id] });
  };

  if (absent) return null;

  return (
    <PanelSection title="AVA's ideas" span="lg:col-span-4">
      {settings ? (
        <div className="grid gap-4 text-xs text-white/60">
          <div className="flex items-center justify-between gap-3">
            <span className="leading-relaxed">
              AVA may start a conversation when she has an idea worth your time. At most one a day.
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={settings.enabled}
              aria-label="AVA's ideas"
              disabled={busy}
              onClick={() => { void save({ enabled: !settings.enabled }); }}
              className={`shrink-0 rounded-full border px-4 py-1.5 text-xs font-medium transition-colors disabled:opacity-60 ${
                settings.enabled ? "border-sky-300/40 bg-sky-300/15 text-sky-50" : "border-white/15 bg-white/[0.04] text-white/60"
              }`}
            >
              {settings.enabled ? "On" : "Off"}
            </button>
          </div>

          <fieldset className="grid gap-2" disabled={busy}>
            <legend className="mb-1 text-white/75">When</legend>
            <label className="flex items-center justify-between gap-3">
              <span>Daily, from (Dublin time)</span>
              <TimeInput value={settings.deliveryLocalTime} label="Idea time" onCommit={(value) => saveTime("deliveryLocalTime", value)} />
            </label>
            <label className="flex items-center justify-between gap-3">
              <span>Quiet from</span>
              <TimeInput value={settings.quietStart} label="Quiet hours start" onCommit={(value) => saveTime("quietStart", value)} />
            </label>
            <label className="flex items-center justify-between gap-3">
              <span>Quiet until</span>
              <TimeInput value={settings.quietEnd} label="Quiet hours end" onCommit={(value) => saveTime("quietEnd", value)} />
            </label>
          </fieldset>

          <fieldset className="grid gap-1.5" disabled={busy}>
            <legend className="mb-1 text-white/75">Projects AVA may think about</legend>
            <span className="leading-relaxed text-white/45">
              Besides what you saved in the last three days. Only folders you tick here count as active.
            </span>
            {folders === null ? (
              <span className="text-white/40">Loading folders…</span>
            ) : folders.length === 0 ? (
              <span className="text-white/40">No project folders yet.</span>
            ) : (
              <div className="grid max-h-48 gap-1 overflow-y-auto pr-1">
                {folders.map((folder) => (
                  <label key={folder.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settings.activeProjectFolderIds.includes(folder.id)}
                      onChange={() => toggleFolder(folder.id)}
                    />
                    <span className="truncate">{folder.path || folder.name}</span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          <p className="leading-relaxed text-white/45">
            Ideas come only while AVA is running on your PC. A notification that was sent to your phone
            may not have been seen, so AVA never treats it as read.
          </p>
          {message && <p role="status" className="text-amber-200/80">{message}</p>}
        </div>
      ) : loadFailed ? (
        <div role="alert" className="grid gap-2 text-xs text-white/50">
          <span>Couldn't load these settings.</span>
          <button type="button" className="btn-deck btn-ghost w-fit" onClick={() => { void load(); }}>Try again</button>
        </div>
      ) : (
        <div className="text-xs text-white/40">Loading…</div>
      )}
    </PanelSection>
  );
}

/** A local time that saves when the field is left, not on every keystroke. */
function TimeInput({ value, label, onCommit }: { value: string; label: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  // Follow a new saved value (a change elsewhere) during render, only when it
  // actually changes. A mount effect here could run after a fast first edit
  // and silently put the old time back.
  const [followed, setFollowed] = useState(value);
  if (value !== followed) {
    setFollowed(value);
    setDraft(value);
  }
  return (
    <input
      type="time"
      aria-label={label}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onCommit(draft)}
      className="rounded-md border border-white/15 bg-white/[0.04] px-2 py-1 text-xs text-white/80"
    />
  );
}
