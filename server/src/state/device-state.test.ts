import { describe, it, expect } from "vitest";
import { openInMemoryDb } from "./db.js";
import {
  getDeviceState,
  markGreetingSent,
  getLastUserMessageBefore,
} from "./device-state.js";
import { createSession } from "./sessions.js";
import { appendMessage } from "./messages.js";

function seedDevice(db: ReturnType<typeof openInMemoryDb>, id: string): void {
  db.prepare(
    "INSERT INTO device_tokens (id, token_hash, label, created_at) VALUES (?, ?, ?, ?)",
  ).run(id, `hash-${id}`, "test", Date.now());
}

describe("device_state", () => {
  it("returns null when device has no row", () => {
    const db = openInMemoryDb();
    seedDevice(db, "d1");
    expect(getDeviceState(db, "d1")).toBeNull();
  });

  it("markGreetingSent inserts on first call, updates on second", () => {
    const db = openInMemoryDb();
    seedDevice(db, "d1");
    markGreetingSent(db, "d1", "2026-04-29");
    expect(getDeviceState(db, "d1")?.last_greeting_date).toBe("2026-04-29");
    markGreetingSent(db, "d1", "2026-04-30");
    expect(getDeviceState(db, "d1")?.last_greeting_date).toBe("2026-04-30");
  });

  it("getLastUserMessageBefore returns the most recent user message in another session", () => {
    const db = openInMemoryDb();
    const s1 = createSession(db, { title: "yesterday's chat" });
    const s2 = createSession(db, { title: "today" });
    appendMessage(db, { sessionId: s1.id, role: "user", content: "old hello" });
    appendMessage(db, { sessionId: s1.id, role: "assistant", content: "old reply" });
    appendMessage(db, { sessionId: s2.id, role: "user", content: "new hello" });
    const result = getLastUserMessageBefore(db, s2.id);
    expect(result?.content).toBe("old hello");
    expect(result?.session_title).toBe("yesterday's chat");
  });

  it("getLastUserMessageBefore returns null when no other sessions exist", () => {
    const db = openInMemoryDb();
    const s = createSession(db, { title: null });
    appendMessage(db, { sessionId: s.id, role: "user", content: "first" });
    expect(getLastUserMessageBefore(db, s.id)).toBeNull();
  });
});
