import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "./db.js";
import { createSession, getSession, getSessionFull, listByStatus, listSessions, setStatus, touchSession, updateSummary, updateTitle } from "./sessions.js";

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
});
