import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "./db.js";
import { createSession, getSession, getSessionFull, listByStatus, listSessions, purgeDeletedSessions, setPinned, setStatus, softDeleteSession, touchSession, updateSummary, updateTitle } from "./sessions.js";

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
