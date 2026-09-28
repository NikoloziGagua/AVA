import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, type Db } from "../state/db.js";
import { createCalendarEvent, getCalendarOccurrence, updateCalendarEvent, upsertCalendarException } from "../calendar/service.js";
import { InitiativeEngine } from "./engine.js";
import { initiativeFixture, NOW, REPLY } from "./fixture.test-helper.js";
import { claimAttempt, duplicateIdea, getInitiative, initiativeView, LEASE_MS, recentIdeas, setDisposition } from "./store.js";
import type { InitiativeCandidate } from "./prompt.js";
import { gatherSources, readSource } from "./sources.js";
import { getInitiativeSettings, updateInitiativeSettings } from "./settings.js";
import { DAY } from "./time.js";
const handles: Db[] = []; const directories: string[] = [];
afterEach(() => { vi.useRealTimers(); handles.splice(0).forEach(db => { if (db.open) db.close(); }); directories.splice(0).forEach(p => rmSync(p, { recursive: true, force: true })); });
function scratch() {
  const base = fileURLToPath(new URL("../../../data/builds/task83/", import.meta.url)); mkdirSync(base, { recursive: true });
  const path = mkdtempSync(join(base, "restart-")); directories.push(path); return join(path, "fixture.db");
}
function connect(path = ":memory:") { const db = openDb(path); handles.push(db); return db; }
describe("durable initiative recovery and source evidence", () => {
  it("two SQLite connections serialize claims; restart preserves attempts, publication and settings", async () => {
    const path = scratch(); const first = connect(path); const f = initiativeFixture(first); const second = connect(path);
    const a = claimAttempt(first, NOW)!;
    expect(claimAttempt(second, NOW)).toBeNull();
    first.close(); second.close();
    const restarted = connect(path); const complete = vi.fn(async () => REPLY);
    const engine = new InitiativeEngine({ db: restarted, now: () => NOW + LEASE_MS + 1, provider: { complete, defaultSideModel: "fixture" } });
    await engine.tick();
    expect(getInitiative(restarted, a.id)).toMatchObject({ state: "published", attempt_count: 2 });
    const view = initiativeView(restarted, a.id)!;
    restarted.close(); const again = connect(path);
    expect(initiativeView(again, a.id)).toEqual(view);
    expect(getInitiativeSettings(again).activeProjectFolderIds).toEqual([f.folder.id]);
    await new InitiativeEngine({ db: again, now: () => NOW + LEASE_MS + 2, provider: { complete, defaultSideModel: "fixture" } }).tick();
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it("two exhausted leases terminalize; a missed date is suppressed without generation", async () => {
    const f = initiativeFixture(connect()); const a = claimAttempt(f.db, NOW)!;
    claimAttempt(f.db, NOW + LEASE_MS + 1);
    f.setNow(NOW + 2 * LEASE_MS + 2); await f.engine.tick();
    expect(getInitiative(f.db, a.id)).toMatchObject({ state: "failed", failure_reason: "generation_failed", attempt_count: 2 });
    expect(f.complete).not.toHaveBeenCalled();
    const g = initiativeFixture(connect()); const b = claimAttempt(g.db, NOW)!;
    g.setNow(NOW + 5 * 3_600_000); await g.engine.tick();
    expect(getInitiative(g.db, b.id)).toMatchObject({ state: "suppressed", suppression_reason: "out_of_window" });
  });
  it("a shutdown drops an outstanding completion and the next instance recovers the lease", async () => {
    const f = initiativeFixture(connect()); let finish!: (r: string) => void;
    f.complete.mockImplementationOnce(() => new Promise(r => { finish = r; }));
    const pending = f.engine.tick(); await vi.waitFor(() => expect(f.complete).toHaveBeenCalledTimes(1));
    f.engine.stop(); finish(REPLY); await pending;
    expect(f.rows()[0]!.state).toBe("generating");
    f.setNow(NOW + LEASE_MS + 1); await new InitiativeEngine(f.deps).tick();
    expect(f.rows()[0]!.state).toBe("published");
  });
  it("14-day same-scope novelty prevents repeat publication even after a conversation is purged", async () => {
    const f = initiativeFixture(connect()); await f.engine.tick(); const original = f.rows()[0]!;
    f.db.prepare("DELETE FROM sessions WHERE id=?").run(original.session_id);
    f.setNow(NOW + DAY); await f.engine.tick();
    expect(f.complete).toHaveBeenCalledTimes(3);
    expect(f.rows()[1]).toMatchObject({ state: "suppressed", suppression_reason: "duplicate" });
    const scope = { kind: "project" as const, folderId: f.folder.id, name: f.folder.name, active: true };
    expect(recentIdeas(f.db, scope, NOW + 15 * DAY)).toHaveLength(0);
  });
  it("Not useful prevents same-scope title or source repeats for 30 days from the decision, not publication", async () => {
    const path = scratch(); const f = initiativeFixture(connect(path)); await f.engine.tick();
    const original = f.rows()[0]!;
    const scope = { kind: "project" as const, folderId: f.folder.id, name: f.folder.name, active: true };
    const decisionAt = NOW + 15 * DAY;
    expect(recentIdeas(f.db, scope, decisionAt)).toHaveLength(0);
    expect(setDisposition(f.db, original.id, "not_useful", 1, decisionAt)?.ok).toBe(true);
    // Stale retry and current-version replay cannot move the feedback deadline.
    expect(setDisposition(f.db, original.id, "not_useful", 1, decisionAt + DAY)?.ok).toBe(false);
    expect(setDisposition(f.db, original.id, "not_useful", 2, decisionAt + DAY)?.ok).toBe(true);
    expect(getInitiative(f.db, original.id)?.disposition_updated_at).toBe(decisionAt);
    f.setNow(decisionAt + DAY); await f.engine.tick();
    expect(f.rows()[1]).toMatchObject({ state: "suppressed", suppression_reason: "duplicate", attempt_count: 2 });
    expect(f.complete.mock.calls[1]![0].user).toContain(original.title);
    f.db.close(); const restarted = connect(path);
    const remembered = recentIdeas(restarted, scope, decisionAt + 30 * DAY);
    expect(remembered.map(row => row.id)).toEqual([original.id]);
    const candidate: InitiativeCandidate = { title: original.title, reasonNow: "Fixture", message: "Fixture", nextStep: "Compare?", sources: JSON.parse(original.sources) };
    expect(duplicateIdea(remembered, { ...candidate, title: "Different title" })).toBe(true);
    expect(duplicateIdea(remembered, { ...candidate, sources: [{ ...candidate.sources[0]!, id: "different-note" } as typeof candidate.sources[number]] })).toBe(true);
    expect(recentIdeas(restarted, { ...scope, folderId: "other-project" }, decisionAt + DAY)).toEqual([]);
    expect(recentIdeas(restarted, { kind: "general" }, decisionAt + DAY)).toEqual([]);
    expect(recentIdeas(restarted, scope, decisionAt + 30 * DAY + 1)).toEqual([]);
  });
  it("Later is not rejection learning and changing a decision doesn't rewrite source provenance", async () => {
    const f = initiativeFixture(connect()); await f.engine.tick(); const row = f.rows()[0]!;
    const scope = { kind: "project" as const, folderId: f.folder.id, name: f.folder.name, active: true };
    setDisposition(f.db, row.id, "later", 1, NOW + 15 * DAY);
    expect(recentIdeas(f.db, scope, NOW + 16 * DAY)).toEqual([]);
    setDisposition(f.db, row.id, "not_useful", 2, NOW + 16 * DAY);
    expect(recentIdeas(f.db, scope, NOW + 17 * DAY)).toHaveLength(1);
    setDisposition(f.db, row.id, "later", 3, NOW + 17 * DAY);
    expect(recentIdeas(f.db, scope, NOW + 18 * DAY)).toEqual([]);
    expect(getInitiative(f.db, row.id)).toMatchObject({ sources: row.sources, title: row.title, published_at: row.published_at, session_id: row.session_id });
  });
  it("exact calendar evidence preserves exception identity, source change and cancellation status", () => {
    const f = initiativeFixture(connect());
    const event = createCalendarEvent(f.db, { title: "Fixture lecture", kind: "lecture", anchorLocalDate: "2026-09-29", startLocalTime: "10:00:00",
      durationMinutes: 60, notesFolderId: f.folder.id, source: "manual" }, NOW);
    const key = `${event.id}:2026-09-29`; const source = getCalendarOccurrence(f.db, key)!;
    const ref = { type: "calendar_occurrence" as const, occurrenceKey: key, eventVersion: source.eventVersion, exceptionVersion: null };
    const scope = { kind: "project" as const, folderId: f.folder.id, name: f.folder.name, active: true };
    const settings = getInitiativeSettings(f.db);
    expect(readSource(f.db, ref, scope, settings).status).toBe("current");
    updateCalendarEvent(f.db, event.id, 1, { title: "Changed lecture" }, NOW);
    expect(readSource(f.db, ref, scope, settings)).toMatchObject({ status: "changed", title: "Changed lecture", eventVersion: 1 });
    upsertCalendarException(f.db, event.id, "2026-09-29", 2, null, { cancelled: true }, NOW);
    expect(readSource(f.db, ref, scope, settings)).toMatchObject({ status: "unavailable", title: null, startsAt: null, endsAt: null });
    expect(getCalendarOccurrence(f.db, `${event.id}:2026-09-30`)).toBeNull();
    expect(getCalendarOccurrence(f.db, "invalid")).toBeNull();
  });
  it("no eligible source suppresses silently; old inactive notes aren't enough", async () => {
    const f = initiativeFixture(connect()); updateInitiativeSettings(f.db, { version: 2, activeProjectFolderIds: [] });
    f.db.prepare("UPDATE notes SET updated_at=?").run(NOW - 4 * DAY);
    expect(gatherSources(f.db, getInitiativeSettings(f.db), NOW)).toBeNull();
    await f.engine.tick(); expect(f.complete).not.toHaveBeenCalled();
    expect(f.rows()[0]).toMatchObject({ state: "suppressed", suppression_reason: "no_eligible_scope" });
  });
});
