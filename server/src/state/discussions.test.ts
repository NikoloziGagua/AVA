import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "./db.js";
import {
  createDiscussion,
  getDiscussion,
  listDiscussions,
  updateDiscussion,
  failStaleDiscussions,
} from "./discussions.js";

describe("discussions store", () => {
  let db: Db;
  beforeEach(() => { db = openDb(":memory:"); });

  it("creates a running discussion and reads it back", () => {
    const id = createDiscussion(db, { topic: "should we cache X", sessionId: "sess-1" });
    expect(id).toMatch(/^[A-Za-z0-9_-]{10,}$/);
    const row = getDiscussion(db, id)!;
    expect(row.topic).toBe("should we cache X");
    expect(row.status).toBe("running");
    expect(row.session_id).toBe("sess-1");
    expect(row.result).toBeNull();
    expect(row.error).toBeNull();
    expect(row.created_at).toBeGreaterThan(0);
  });

  it("accepts a null sessionId", () => {
    const id = createDiscussion(db, { topic: "t", sessionId: null });
    expect(getDiscussion(db, id)!.session_id).toBeNull();
  });

  it("returns null for an unknown id", () => {
    expect(getDiscussion(db, "nope")).toBeNull();
  });

  it("patches fields and reads them back", () => {
    const id = createDiscussion(db, { topic: "t", sessionId: null });
    updateDiscussion(db, id, { status: "done", result: "Claude says yes" });
    const row = getDiscussion(db, id)!;
    expect(row.status).toBe("done");
    expect(row.result).toBe("Claude says yes");

    updateDiscussion(db, id, { status: "failed", error: "boom" });
    const row2 = getDiscussion(db, id)!;
    expect(row2.status).toBe("failed");
    expect(row2.error).toBe("boom");
  });

  it("updateDiscussion with an empty patch is a no-op", () => {
    const id = createDiscussion(db, { topic: "t", sessionId: null });
    updateDiscussion(db, id, {});
    expect(getDiscussion(db, id)!.status).toBe("running");
  });

  it("lists newest first and honors the limit", () => {
    const a = createDiscussion(db, { topic: "a", sessionId: null });
    const b = createDiscussion(db, { topic: "b", sessionId: null });
    const c = createDiscussion(db, { topic: "c", sessionId: null });
    expect(listDiscussions(db).map((r) => r.id)).toEqual([c, b, a]);
    expect(listDiscussions(db, 2).map((r) => r.id)).toEqual([c, b]);
  });

  it("failStaleDiscussions marks running ones failed, leaves terminal ones", () => {
    const running = createDiscussion(db, { topic: "running", sessionId: null });
    const done = createDiscussion(db, { topic: "done", sessionId: null });
    updateDiscussion(db, done, { status: "done", result: "r" });
    const failed = createDiscussion(db, { topic: "failed", sessionId: null });
    updateDiscussion(db, failed, { status: "failed", error: "e" });

    const n = failStaleDiscussions(db);
    expect(n).toBe(1);
    expect(getDiscussion(db, running)!.status).toBe("failed");
    expect(getDiscussion(db, running)!.error).toMatch(/restart/i);
    expect(getDiscussion(db, done)!.status).toBe("done");
    expect(getDiscussion(db, failed)!.error).toBe("e"); // existing error untouched

    expect(failStaleDiscussions(db)).toBe(0); // idempotent
  });
});
