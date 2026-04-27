import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "./db.js";
import { createSession, getSession, listSessions, touchSession } from "./sessions.js";

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
});
