import { useEffect, useState } from "react";
import { fetchAgentroomStatus, setAgentroomEnabled, type AgentroomStatus } from "../api.js";
import { PanelSection } from "../components/ava/PanelShell.js";

/** One plain line describing where AVA's room connection stands. */
export function devRoomStatusLine(status: AgentroomStatus): string {
  switch (status.availability) {
    case "ready": return `Connected as AVA${status.roomName ? ` in ${status.roomName}` : ""}.`;
    case "disabled": return "Off. AVA won't read or post in the dev room.";
    case "unconfigured": return "Not set up yet: AVA needs her room login in the server settings.";
    case "unreachable": return "Can't reach the room right now.";
    case "identity_mismatch": return "The room login isn't AVA's, so it stays off.";
  }
}

/**
 * Settings row for AVA's development-room membership (contract ava-room-member).
 * The switch is versioned: a stale or refused change shows the server's truth.
 */
export function DevRoomSection() {
  const [status, setStatus] = useState<AgentroomStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchAgentroomStatus()
      .then((s) => { if (alive) setStatus(s); })
      .catch(() => { if (alive) setError("Couldn't load the dev room status."); });
    return () => { alive = false; };
  }, []);

  const toggle = async () => {
    if (!status || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await setAgentroomEnabled(!status.enabled, status.version);
      setStatus(result.status);
      if (!result.ok) {
        setError(result.error === "stale_version"
          ? "The setting changed elsewhere; showing the latest."
          : devRoomStatusLine(result.status));
      }
    } catch {
      setError("Couldn't change the setting. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <PanelSection title="Dev room" span="lg:col-span-4">
      {status ? (
        <>
          <button
            type="button"
            role="switch"
            aria-checked={status.enabled}
            aria-label="AVA in the dev room"
            disabled={busy}
            onClick={() => { void toggle(); }}
            className={`rounded-full border px-4 py-1.5 text-xs font-medium transition-colors disabled:opacity-60 ${
              status.enabled ? "border-sky-300/40 bg-sky-300/15 text-sky-50" : "border-white/15 bg-white/[0.04] text-white/60"
            }`}
          >
            {status.enabled ? "On" : "Off"}
          </button>
          <div className="mt-2 text-[10px] leading-relaxed text-white/45" data-testid="dev-room-status">
            {devRoomStatusLine(status)}
          </div>
        </>
      ) : !error ? (
        <div className="text-xs text-white/40">Loading…</div>
      ) : null}
      {error && <div role="alert" className="mt-2 text-[10px] text-amber-200/80">{error}</div>}
    </PanelSection>
  );
}
