import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "./db.js";
import { createSession } from "./sessions.js";
import { appendMessage, listMessages } from "./messages.js";

describe("messages repo", () => {
  let db: Db;
  let sessionId: string;
  beforeEach(() => {
    db = openDb(":memory:");
    sessionId = createSession(db, { title: null }).id;
  });

  it("appends a message and returns id", () => {
    const m = appendMessage(db, { sessionId, role: "user", content: "hi" });
    expect(m.id).toBeGreaterThan(0);
    expect(m.role).toBe("user");
    expect(m.content).toBe("hi");
  });

  it("lists messages in insertion order", () => {
    appendMessage(db, { sessionId, role: "user", content: "1" });
    appendMessage(db, { sessionId, role: "assistant", content: "2" });
    appendMessage(db, { sessionId, role: "user", content: "3" });
    const list = listMessages(db, sessionId);
    expect(list.map((m) => m.content)).toEqual(["1", "2", "3"]);
  });

  it("isolates by session_id", () => {
    const otherSession = createSession(db, { title: null }).id;
    appendMessage(db, { sessionId, role: "user", content: "mine" });
    appendMessage(db, { sessionId: otherSession, role: "user", content: "other" });
    const list = listMessages(db, sessionId);
    expect(list).toHaveLength(1);
    expect(list[0]?.content).toBe("mine");
  });
});
