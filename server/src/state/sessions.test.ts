import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "./db.js";
import { createSession, getMostRecentSession, getSession, getSessionFull, listByStatus, listSessions, purgeDeletedSessions, setPinned, setStatus, softDeleteSession, touchSession, updateSummary, updateTitle } from "./sessions.js";
import { getMostRecentHumanSession, listSessionsPage, markHumanActivity, SessionListError, type SessionScope } from "./sessions.js";

describe("sessions repo", () => {
  let db: Db;
  beforeEach(() => { db = openDb(":memory:"); });

  it("creates a session with id, timestamps, default status", () => {
    const s = createSession(db, { title: "Hello" });
    expect(s.id).toMatch(/^[A-Za-z0-9_-]{10,}$/);
    expect(s.title).toBe("Hello");
    expect(s.status).toBe("active");
    expect(s.created_at).toBeGreaterThan(0);
    expect(s.updated_at).toBe(s.created_at);
  });

  it("retrieves a created session by id", () => {
    const s = createSession(db, { title: "X" });
    const got = getSession(db, s.id);
    expect(got?.title).toBe("X");
  });

  it("returns null for unknown id", () => {
    expect(getSession(db, "nope")).toBeNull();
  });

  it("lists sessions newest first", () => {
    const a = createSession(db, { title: "A" });
    db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(a.updated_at - 1000, a.id);
    const b = createSession(db, { title: "B" });
    const all = listSessions(db);
    expect(all[0]?.id).toBe(b.id);
    expect(all[1]?.id).toBe(a.id);
  });

  it("touch bumps updated_at", () => {
    const s = createSession(db, { title: "T" });
    const original = s.updated_at;
    db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(original - 5000, s.id);
    touchSession(db, s.id);
    const got = getSession(db, s.id)!;
    expect(got.updated_at).toBeGreaterThan(original - 5000);
  });

  it("updateTitle writes the new title", () => {
    const s = createSession(db, { title: "old" });
    updateTitle(db, s.id, "new title");
    expect(getSession(db, s.id)?.title).toBe("new title");
  });

  it("getSessionFull returns null for unknown id", () => {
    expect(getSessionFull(db, "nope")).toBeNull();
  });

  it("getSessionFull returns summary fields as null for fresh session", () => {
    const s = createSession(db, { title: "X" });
    const full = getSessionFull(db, s.id)!;
    expect(full.summary).toBeNull();
    expect(full.summary_through_message_id).toBeNull();
  });

  it("updateSummary round-trips into getSessionFull", () => {
    const s = createSession(db, { title: "X" });
    updateSummary(db, s.id, "earlier discussion", 42);
    const full = getSessionFull(db, s.id)!;
    expect(full.summary).toBe("earlier discussion");
    expect(full.summary_through_message_id).toBe(42);
  });

  it("setStatus updates the status field and bumps updated_at", () => {
    const s = createSession(db, { title: "X" });
    db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(s.updated_at - 5000, s.id);
    setStatus(db, s.id, "interrupted");
    const got = getSession(db, s.id)!;
    expect(got.status).toBe("interrupted");
    expect(got.updated_at).toBeGreaterThan(s.updated_at - 5000);
  });

  it("listByStatus returns only matching sessions, newest first", () => {
    const a = createSession(db, { title: "A" });
    const b = createSession(db, { title: "B" });
    const c = createSession(db, { title: "C" });
    setStatus(db, a.id, "idle");
    setStatus(db, c.id, "idle");
    // bump b update so it stays active and newer
    db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(Date.now() + 1000, b.id);
    const idle = listByStatus(db, "idle");
    expect(idle.map((s) => s.id).sort()).toEqual([a.id, c.id].sort());
    const active = listByStatus(db, "active");
    expect(active.map((s) => s.id)).toEqual([b.id]);
  });

  it("listByStatus returns [] when no sessions match", () => {
    createSession(db, { title: "x" });
    expect(listByStatus(db, "interrupted")).toEqual([]);
  });

  it("setPinned flips the pinned flag", () => {
    const s = createSession(db, { title: "x" });
    expect(getSession(db, s.id)?.pinned).toBe(0);
    setPinned(db, s.id, true);
    expect(getSession(db, s.id)?.pinned).toBe(1);
    setPinned(db, s.id, false);
    expect(getSession(db, s.id)?.pinned).toBe(0);
  });

  it("listSessions returns pinned sessions first", () => {
    const older = createSession(db, { title: "older" });
    // make `older` the less-recent of the two
    db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(older.updated_at - 1000, older.id);
    const newer = createSession(db, { title: "newer" });
    // before pinning, newer sorts first by recency
    expect(listSessions(db).map((s) => s.id)).toEqual([newer.id, older.id]);
    // pin the older one; it should now sort ahead despite being less recent
    setPinned(db, older.id, true);
    const all = listSessions(db);
    expect(all[0]?.id).toBe(older.id);
    expect(all[1]?.id).toBe(newer.id);
  });

  it("gets the actually most-recent session without treating a pin as activity", () => {
    const pinnedOlder = createSession(db, { title: "pinned older" });
    const recent = createSession(db, { title: "recent" });
    db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(100, pinnedOlder.id);
    db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(200, recent.id);
    setPinned(db, pinnedOlder.id, true);

    expect(listSessions(db)[0]?.id).toBe(pinnedOlder.id);
    expect(getMostRecentSession(db)?.id).toBe(recent.id);
  });
});

describe("human activity and scoped history", () => {
  it("does not infer provenance or recency from creation, pins or metadata", () => {
    const db = openDb(":memory:");
    const legacy = createSession(db, { title: "Watch: misleading title" });
    expect(legacy).toMatchObject({ origin: "unknown", last_human_activity_at: null });
    setPinned(db, legacy.id, true);
    updateTitle(db, legacy.id, "A human-looking title");
    updateSummary(db, legacy.id, "summary", 1);
    touchSession(db, legacy.id);
    setStatus(db, legacy.id, "idle");
    expect(getSession(db, legacy.id)).toMatchObject({ origin: "unknown", last_human_activity_at: null });
    expect(getMostRecentHumanSession(db)).toBeNull();
    db.close();
  });

  it("stamps human activity monotonically but never stamps automation/deleted rows", () => {
    const db = openDb(":memory:");
    const human = createSession(db, { origin: "human" });
    const legacy = createSession(db, {});
    const automation = createSession(db, { origin: "automation" });
    markHumanActivity(db, human.id, 200);
    markHumanActivity(db, human.id, 100);
    markHumanActivity(db, legacy.id, 150);
    markHumanActivity(db, automation.id, 300);
    expect(getSession(db, human.id)?.last_human_activity_at).toBe(200);
    expect(getSession(db, legacy.id)).toMatchObject({ origin: "unknown", last_human_activity_at: 150 });
    expect(getSession(db, automation.id)?.last_human_activity_at).toBeNull();
    expect(getSession(db, human.id)?.updated_at).toBe(human.updated_at);
    softDeleteSession(db, human.id);
    markHumanActivity(db, human.id, 400);
    expect(getSessionFull(db, human.id)).toBeNull();
    expect(db.prepare("SELECT last_human_activity_at FROM sessions WHERE id = ?").get(human.id)).toEqual({ last_human_activity_at: 200 });
    expect(() => markHumanActivity(db, legacy.id, NaN)).toThrow(RangeError);
    db.close();
  });

  it("keeps legacy/pinned/automation discoverable without making pins activity", () => {
    const db = openDb(":memory:");
    const human = createSession(db, { origin: "human" });
    const legacy = createSession(db, {});
    const pinnedLegacy = createSession(db, {});
    const activeLegacy = createSession(db, {});
    const automation = createSession(db, { origin: "automation" });
    const archived = createSession(db, { origin: "human" });
    const deleted = createSession(db, { origin: "human" });
    markHumanActivity(db, human.id, 100);
    markHumanActivity(db, activeLegacy.id, 200);
    markHumanActivity(db, archived.id, 999);
    setPinned(db, pinnedLegacy.id, true);
    setPinned(db, automation.id, true);
    setStatus(db, archived.id, "archived");
    softDeleteSession(db, deleted.id);
    const ids = (scope: SessionScope) => listSessionsPage(db, { scope }).sessions.map(s => s.id);
    expect(ids("human")).toEqual([pinnedLegacy.id, activeLegacy.id, human.id]);
    expect(ids("legacy").sort()).toEqual([legacy.id, pinnedLegacy.id].sort());
    expect(ids("automation")).toEqual([automation.id]);
    expect(ids("all")).toHaveLength(6);
    expect(getMostRecentHumanSession(db)?.id).toBe(activeLegacy.id);
    db.close();
  });

  it("does not list a human conversation until its first accepted human turn (v4)", () => {
    const db = openDb(":memory:");
    const used = createSession(db, { origin: "human" });
    const neverUsed = createSession(db, { origin: "human" });
    const pinnedNeverUsed = createSession(db, { origin: "human" });
    markHumanActivity(db, used.id, 100);
    setPinned(db, pinnedNeverUsed.id, true);
    const ids = (scope: SessionScope) => listSessionsPage(db, { scope }).sessions.map(s => s.id);
    // Hidden from recents, never deleted: exact lookup and scope=all still see it.
    expect(ids("human")).toEqual([pinnedNeverUsed.id, used.id]);
    expect(ids("all")).toContain(neverUsed.id);
    expect(getSession(db, neverUsed.id)?.id).toBe(neverUsed.id);
    expect(ids("legacy")).not.toContain(neverUsed.id);
    // Its first real turn makes it an ordinary recent conversation.
    markHumanActivity(db, neverUsed.id, 200);
    expect(ids("human")).toEqual([pinnedNeverUsed.id, neverUsed.id, used.id]);
    db.close();
  });

  it.each<SessionScope>(["human", "automation", "legacy", "all"])("paginates 253 %s rows with tied/null timestamps without loss or duplicates", (scope) => {
    const db = openDb(":memory:");
    const insert = db.prepare(`INSERT INTO sessions
      (id, created_at, updated_at, origin, pinned, last_human_activity_at)
      VALUES (?, 100, ?, ?, ?, ?)`);
    for (let i = 0; i < 253; i++) {
      insert.run(`session-${String(i).padStart(4, "0")}`, 100 + i % 5,
        scope === "automation" ? "automation" : scope === "legacy" ? "unknown" : "human",
        i % 3 === 0 ? 1 : 0, scope === "legacy" || i % 4 === 0 ? null : 100 + i % 7);
    }
    const order = scope === "human" ? "last_human_activity_at" : "updated_at";
    // Never-used human rows are not listed (v4); pinned ones keep the NULL-timestamp path covered.
    const listed = scope === "human" ? "WHERE last_human_activity_at IS NOT NULL OR pinned = 1" : "";
    const expected = (db.prepare(`SELECT id FROM sessions ${listed} ORDER BY pinned DESC, ${order} DESC NULLS LAST, id DESC`).all() as { id: string }[]).map(row => row.id);
    const actual: string[] = [];
    let cursor: string | undefined;
    do {
      const page = listSessionsPage(db, { scope, limit: 17, cursor });
      expect(page.sessions.length).toBeLessThanOrEqual(17);
      actual.push(...page.sessions.map(row => row.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(actual).toEqual(expected);
    expect(new Set(actual).size).toBe(expected.length);
    expect(expected.length).toBe(scope === "human" ? 253 - 42 : 253);
    db.close();
  });

  it("rejects malformed, cross-scope and wrong-order cursors", () => {
    const db = openDb(":memory:");
    markHumanActivity(db, createSession(db, { origin: "human" }).id, 100);
    markHumanActivity(db, createSession(db, { origin: "human" }).id, 200);
    const cursor = listSessionsPage(db, { scope: "human", limit: 1 }).nextCursor!;
    expect(() => listSessionsPage(db, { scope: "all", cursor })).toThrow(SessionListError);
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    for (const invalid of ["", "???", cursor + "=", encode(null), encode({}),
      encode({ ...parsed, order: "updated" }), encode({ ...parsed, at: "100" }),
      encode({ ...parsed, pinned: 2 }), encode({ ...parsed, extra: true })]) {
      expect(() => listSessionsPage(db, { scope: "human", cursor: invalid })).toThrow(SessionListError);
    }
    for (const limit of [0, -1, 101, 1.5, NaN]) {
      expect(() => listSessionsPage(db, { scope: "human", limit })).toThrow(SessionListError);
    }
    db.close();
  });
});

describe("soft delete", () => {
  it("softDeleteSession sets deleted_at to now", () => {
    const db = openDb(":memory:");
    const s = createSession(db, { title: "x" });
    const before = Date.now();
    softDeleteSession(db, s.id);
    const row = db.prepare("SELECT deleted_at FROM sessions WHERE id = ?").get(s.id) as { deleted_at: number };
    expect(row.deleted_at).toBeGreaterThanOrEqual(before);
  });

  it("listSessions excludes soft-deleted rows", () => {
    const db = openDb(":memory:");
    const a = createSession(db, { title: "a" });
    const b = createSession(db, { title: "b" });
    softDeleteSession(db, a.id);
    const all = listSessions(db);
    expect(all.map((s) => s.id)).toEqual([b.id]);
  });

  it("getSession returns null for soft-deleted session", () => {
    const db = openDb(":memory:");
    const s = createSession(db, { title: "x" });
    softDeleteSession(db, s.id);
    expect(getSession(db, s.id)).toBeNull();
  });
});

describe("purgeDeletedSessions", () => {
  it("hard-deletes rows whose deleted_at is older than the threshold", () => {
    const db = openDb(":memory:");
    const old = createSession(db, { title: "old" });
    const fresh = createSession(db, { title: "fresh" });
    db.prepare("UPDATE sessions SET deleted_at = ? WHERE id = ?").run(1000, old.id);
    db.prepare("UPDATE sessions SET deleted_at = ? WHERE id = ?").run(Date.now(), fresh.id);
    const removed = purgeDeletedSessions(db, Date.now() - 24 * 60 * 60 * 1000);
    expect(removed).toBe(1);
    const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(old.id);
    expect(row).toBeUndefined();
  });

  it("keeps rows with NULL deleted_at", () => {
    const db = openDb(":memory:");
    const a = createSession(db, { title: "a" });
    const removed = purgeDeletedSessions(db, Date.now());
    expect(removed).toBe(0);
    expect(db.prepare("SELECT id FROM sessions WHERE id = ?").get(a.id)).toBeDefined();
  });
});
