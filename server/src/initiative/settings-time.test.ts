import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "../state/db.js";
import { createNoteFolder } from "../state/notes.js";
import { DEFAULT_SETTINGS, getInitiativeSettings, updateInitiativeSettings } from "./settings.js";
import { isQuiet, occurrenceWindow, resolveMinute } from "./time.js";
const handles: ReturnType<typeof openDb>[] = [];
const db = () => { const result = openDb(":memory:"); handles.push(result); return result; };
afterEach(() => handles.splice(0).forEach(d => d.close()));
describe("initiative settings", () => {
  it("reads default-off without writing and applies a strict stale-guarded patch", () => {
    const d = db();
    expect(getInitiativeSettings(d)).toEqual(DEFAULT_SETTINGS);
    expect(d.prepare("SELECT count(*) n FROM initiative_settings").get()).toEqual({ n: 0 });
    expect(updateInitiativeSettings(d, { version: 2, enabled: true })).toBe("stale_version");
    expect(updateInitiativeSettings(d, { version: 1, enabled: true })).toMatchObject({ enabled: true, version: 2 });
    expect(updateInitiativeSettings(d, { version: 1, enabled: false })).toBe("stale_version");
    expect(getInitiativeSettings(d).enabled).toBe(true);
  });
  it("rejects oversized/unknown/invalid settings and nonexistent folders without mutation", () => {
    const d = db(); const folder = createNoteFolder(d, { name: "Project" });
    for (const patch of [{ enabled: "true" }, { deliveryLocalTime: "24:00" }, { quietStart: "8:00" },
      { activeProjectFolderIds: ["missing"] }, { activeProjectFolderIds: Array(33).fill(folder.id) },
      { activeProjectFolderIds: [folder.id, folder.id] }, { timeZone: "UTC" }, { version: -1 }]) {
      expect(updateInitiativeSettings(d, { version: 1, ...patch })).toBe("bad_request");
    }
    expect(updateInitiativeSettings(d, { version: 1, activeProjectFolderIds: [folder.id] })).toMatchObject({ version: 2 });
  });
});
describe("Dublin daily occurrence", () => {
  it("uses Dublin rather than host timezone, never backfills, clips quiet hours", () => {
    const at = (s: string) => Date.parse(s);
    expect(occurrenceWindow(at("2026-09-28T10:00:00Z"), DEFAULT_SETTINGS)).toMatchObject({ key: "daily:2026-09-28", eligible: true });
    expect(occurrenceWindow(at("2026-09-28T13:00:00Z"), DEFAULT_SETTINGS).eligible).toBe(false);
    const morning = { ...DEFAULT_SETTINGS, deliveryLocalTime: "07:00" };
    expect(occurrenceWindow(at("2026-09-28T07:29:00Z"), morning).eligible).toBe(false);
    expect(occurrenceWindow(at("2026-09-28T07:30:00Z"), morning).eligible).toBe(true);
    expect(occurrenceWindow(at("2026-09-28T09:00:00Z"), morning).eligible).toBe(false);
    expect(isQuiet(at("2026-09-28T21:30:00Z"), DEFAULT_SETTINGS)).toBe(true);
  });
  it("resolves the gap to first valid minute and overlap to first instance", () => {
    expect(resolveMinute("2026-03-29", "01:30")).toBe(Date.parse("2026-03-29T01:00:00Z"));
    expect(resolveMinute("2026-10-25", "01:30")).toBe(Date.parse("2026-10-25T00:30:00Z"));
    const s = { ...DEFAULT_SETTINGS, quietStart: "23:00", quietEnd: "00:00", deliveryLocalTime: "01:30" };
    expect(occurrenceWindow(Date.parse("2026-10-25T01:30:00Z"), s).key).toBe("daily:2026-10-25");
    expect(occurrenceWindow(Date.parse("2026-10-25T00:30:00Z"), s).from).toBe(occurrenceWindow(Date.parse("2026-10-25T01:30:00Z"), s).from);
  });
  it("equal quiet boundaries mean all-day quiet; no cross-date publication", () => {
    expect(occurrenceWindow(Date.parse("2026-09-28T11:00Z"), { ...DEFAULT_SETTINGS, quietStart: "09:00", quietEnd: "09:00" }).eligible).toBe(false);
    const s = { ...DEFAULT_SETTINGS, deliveryLocalTime: "23:30", quietStart: "03:00", quietEnd: "04:00" };
    expect(occurrenceWindow(Date.parse("2026-09-28T22:30Z"), s).to).toBe(Date.parse("2026-09-28T23:00Z"));
  });
});
