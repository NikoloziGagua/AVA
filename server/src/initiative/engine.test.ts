import { afterEach, describe, expect, it, vi } from "vitest";
import { createNote, createNoteFolder, updateNote } from "../state/notes.js";
import { listMessages } from "../state/messages.js";
import { listSessionsPage, markHumanActivity } from "../state/sessions.js";
import { upsertSubscription } from "../state/push.js";
import { InitiativeEngine } from "./engine.js";
import { initiativeFixture, NOW, REPLY } from "./fixture.test-helper.js";
import { getInitiativeSettings, updateInitiativeSettings } from "./settings.js";
import { getInitiative, initiativeView, LEASE_MS, markOpened, setDisposition } from "./store.js";
import { gatherSources } from "./sources.js";
const fixtures: ReturnType<typeof initiativeFixture>[] = [];
const setup = () => { const f = initiativeFixture(); fixtures.push(f); return f; };
afterEach(() => { vi.useRealTimers(); fixtures.splice(0).forEach(f => f.db.close()); });
const deferred = () => { let resolve!: (value: string) => void; const promise = new Promise<string>(r => { resolve = r; }); return { promise, resolve }; };
describe("initiative engine", () => {
  it("publishes one ordinary invitation atomically, no user activity or auto-capture", async () => {
    const f = setup(); await f.engine.tick(); await f.engine.tick();
    expect(f.complete).toHaveBeenCalledTimes(1);
    const row = f.rows()[0]!;
    expect(row).toMatchObject({ state: "published", attempt_count: 1, notification_state: "no_subscription" });
    expect(listSessionsPage(f.db, { scope: "human" }).sessions).toHaveLength(0);
    expect(listSessionsPage(f.db, { scope: "inbox" }).sessions).toHaveLength(1);
    expect(listMessages(f.db, row.session_id!)).toMatchObject([{ role: "assistant" }]);
    expect(f.db.prepare("SELECT count(*) n FROM memory_index_auto_events").get()).toEqual({ n: 0 });
    expect(f.db.prepare("SELECT count(*) n FROM memory_index_entries").get()).toEqual({ n: 0 });
    expect(initiativeView(f.db, row.id)?.sources[0]?.status).toBe("current");
    markHumanActivity(f.db, row.session_id!, NOW + 1);
    expect(getInitiative(f.db, row.id)?.disposition_state).toBe("engaged");
  });
  it("cheap gates avoid provider work and missed-day backfill", async () => {
    const f = setup();
    updateInitiativeSettings(f.db, { version: 2, enabled: false }); await f.engine.tick();
    expect(f.rows()).toHaveLength(0);
    updateInitiativeSettings(f.db, { version: 3, enabled: true });
    f.setNow(Date.parse("2026-09-28T21:45Z")); await f.engine.tick();
    f.setNow(Date.parse("2026-09-29T13:01Z")); await f.engine.tick();
    expect(f.complete).not.toHaveBeenCalled(); expect(f.rows()).toHaveLength(0);
  });

  it("missing provider does not claim work; oversize completion never publishes", async () => {
    const f = setup(); await new InitiativeEngine({ ...f.deps, provider: null }).tick();
    expect(f.rows()).toHaveLength(0);
    f.complete.mockResolvedValue("x".repeat(16_001)); await f.engine.tick();
    expect(f.rows()[0]).toMatchObject({ state: "failed", failure_reason: "generation_failed" });
  });

  it("clearing active-folder status while generating forces fresh inactive wording", async () => {
    const f = setup();
    f.complete.mockImplementationOnce(async () => {
      updateInitiativeSettings(f.db, { version: 2, activeProjectFolderIds: [] });
      return REPLY;
    });
    await f.engine.tick();
    expect(f.complete).toHaveBeenCalledTimes(2);
    expect(f.rows()[0]).toMatchObject({ state: "published", attempt_count: 2 });
  });

  it("real deadline bounds a hanging provider; expired attempt cannot claim a terminal result", async () => {
    vi.useFakeTimers(); const f = setup(); f.complete.mockImplementation(() => new Promise(() => {}));
    const pending = f.engine.tick();
    await vi.advanceTimersByTimeAsync(1);
    f.setNow(NOW + LEASE_MS);
    await vi.advanceTimersByTimeAsync(LEASE_MS);
    await pending;
    expect(f.rows()[0]!.state).toBe("generating");
    expect(f.report.mock.calls.filter(call => call[0].state === "failed")).toHaveLength(0);
    f.setNow(NOW + 4 * 3_600_000); f.engine.recover();
    expect(f.rows()[0]).toMatchObject({ state: "suppressed", suppression_reason: "out_of_window" });
  });
  it.each(["disable", "quiet", "window"])("rechecks %s after the provider response", async (change) => {
    const f = setup(); const d = deferred(); f.complete.mockImplementation(() => d.promise);
    const run = f.engine.tick(); await vi.waitFor(() => expect(f.complete).toHaveBeenCalledTimes(1));
    if (change === "disable") updateInitiativeSettings(f.db, { version: 2, enabled: false });
    else if (change === "quiet") updateInitiativeSettings(f.db, { version: 2, quietStart: "10:30", quietEnd: "12:00" });
    else f.setNow(NOW + 3 * 3_600_000);
    d.resolve(REPLY); await run;
    expect(f.rows()[0]?.state).not.toBe("published");
    expect(listSessionsPage(f.db, { scope: "all" }).sessions).toHaveLength(0);
  });
  it("suppresses no idea and rejects malformed, ungrounded or secret output", async () => {
    for (const reply of ['{"decision":"none"}', "garbage", REPLY.replace('"S1"', '"S9"'), REPLY.replace("Niko,", "api_key=sk-test-123456789012345678901234567890 Niko,")]) {
      const f = setup(); f.complete.mockResolvedValue(reply); await f.engine.tick();
      expect(f.rows()[0]?.state).not.toBe("published");
      expect(listSessionsPage(f.db, { scope: "all" }).sessions).toHaveLength(0);
      expect(JSON.stringify(f.rows())).not.toContain("sk-test-");
    }
  });
  it("re-reads changed sources, allowing only one regeneration", async () => {
    const f = setup(); f.complete.mockImplementation(async () => {
      const note = f.db.prepare("SELECT version FROM notes WHERE id=?").get(f.note.id) as { version: number };
      updateNote(f.db, f.note.id, note.version, { content: `Changed source version ${note.version}` });
      return REPLY;
    });
    await f.engine.tick();
    expect(f.complete).toHaveBeenCalledTimes(2);
    expect(f.rows()[0]).toMatchObject({ state: "suppressed", suppression_reason: "stale_source", attempt_count: 2 });
  });
  it("two engines and duplicate ticks cannot publish twice; a late expired attempt is fenced", async () => {
    const f = setup(); const a = deferred(); f.complete.mockImplementationOnce(() => a.promise).mockResolvedValue(REPLY);
    const first = f.engine.tick(); await vi.waitFor(() => expect(f.complete).toHaveBeenCalledTimes(1));
    const second = new InitiativeEngine(f.deps);
    await second.tick(); expect(f.complete).toHaveBeenCalledTimes(1);
    f.setNow(NOW + LEASE_MS + 1); await second.tick();
    const before = f.rows();
    a.resolve(REPLY); await first;
    expect(f.rows()).toEqual(before);
    expect(before[0]).toMatchObject({ state: "published", attempt_count: 2 });
    expect(listSessionsPage(f.db, { scope: "all" }).sessions).toHaveLength(1);
  });
  it("errors are bounded, and publication failure rolls back the whole conversation", async () => {
    const f = setup(); f.complete.mockRejectedValue(new Error("sensitive provider dump"));
    await f.engine.tick(); await f.engine.tick();
    expect(f.complete).toHaveBeenCalledTimes(2);
    expect(f.rows()[0]).toMatchObject({ state: "failed", failure_reason: "generation_failed" });
    expect(JSON.stringify(f.rows())).not.toContain("sensitive");
    const g = setup(); g.db.exec("CREATE TRIGGER fail_message BEFORE INSERT ON messages BEGIN SELECT RAISE(ABORT,'fixture'); END;");
    await g.engine.tick();
    expect(g.rows()[0]).toMatchObject({ state: "failed", failure_reason: "publication_failed" });
    expect(listSessionsPage(g.db, { scope: "all" }).sessions).toHaveLength(0);
  });
  it("projects and explicitly active descendants never mix; outbound source secrets are scrubbed", () => {
    const f = setup(); const child = createNoteFolder(f.db, { name: "Separate", parentId: f.folder.id });
    const other = createNote(f.db, { folderId: child.id, title: "Other project", content: "Never include this in the parent" });
    f.db.prepare("UPDATE notes SET updated_at=? WHERE id=?").run(NOW, other.id);
    updateInitiativeSettings(f.db, { version: 2, activeProjectFolderIds: [f.folder.id, child.id] });
    // Legacy unsanitized storage must still be scrubbed at the provider boundary.
    f.db.prepare("UPDATE notes SET content=? WHERE id=?").run("password=fixture-secret-value", f.note.id);
    const result = gatherSources(f.db, getInitiativeSettings(f.db), NOW, { kind: "project", folderId: f.folder.id, name: f.folder.name, active: true });
    expect(result?.sources.map(s => s.type === "note" ? s.id : "")).toEqual([f.note.id]);
    expect(JSON.stringify(result)).not.toContain("fixture-secret-value");
  });
  it("single-winner notification claim, unknown crash recovery, and no re-push on Later", async () => {
    const f = setup(); await f.engine.tick(); const row = f.rows()[0]!;
    upsertSubscription(f.db, { endpoint: "https://example.test/push", p256dh: "fixture", auth: "fixture", deviceLabel: null, deviceTokenId: null });
    f.db.prepare("UPDATE initiatives SET notification_state='none' WHERE id=?").run(row.id);
    let finish!: (value: any) => void;
    const deliver = vi.fn(() => new Promise<any>(r => { finish = r; }));
    const a = new InitiativeEngine({ ...f.deps, deliver }); const b = new InitiativeEngine({ ...f.deps, deliver });
    const sending = a.notifyPending(); await b.notifyPending(); expect(deliver).toHaveBeenCalledTimes(1);
    f.setNow(NOW + 25_001); b.recover();
    finish({ subscriptions: { total: 1, accepted: 1, rejectedTransient: 0, rejectedPermanent: 0, unknown: 0 }, reasonCode: null });
    await sending;
    expect(getInitiative(f.db, row.id)?.notification_state).toBe("unknown");
    setDisposition(f.db, row.id, "later", 1, NOW + 30_000); markOpened(f.db, row.id, NOW + 30_001);
    await b.notifyPending(); expect(deliver).toHaveBeenCalledTimes(1);
  });
});
