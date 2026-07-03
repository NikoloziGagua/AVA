import { describe, it, expect } from "vitest";
import { openInMemoryDb } from "../state/db.js";
import { decideGreeting } from "./greeting.js";
import { createSession } from "../state/sessions.js";
import { appendMessage } from "../state/messages.js";
import { markGreetingSent } from "../state/device-state.js";

function seedDevice(db: ReturnType<typeof openInMemoryDb>, id: string): void {
  db.prepare(
    "INSERT INTO device_tokens (id, token_hash, label, created_at) VALUES (?, ?, ?, ?)",
  ).run(id, `hash-${id}`, "test", Date.now());
}

describe("decideGreeting", () => {
  const NOON = new Date("2026-04-29T12:00:00").getTime();

  it("returns greet=false when deviceId is missing", () => {
    const db = openInMemoryDb();
    expect(decideGreeting({ db, deviceId: null, sessionId: "x", today: "2026-04-29" }).greet).toBe(false);
  });

  it("returns greet=true on first call of the day", () => {
    const db = openInMemoryDb();
    seedDevice(db, "d1");
    const s = createSession(db, { title: null });
    const r = decideGreeting({ db, deviceId: "d1", sessionId: s.id, today: "2026-04-29", now: NOON });
    expect(r.greet).toBe(true);
    expect(r.prefix).toContain("[GREETING CONTEXT]");
    expect(r.prefix).toContain("2026-04-29");
    expect(r.prefix).toContain("afternoon"); // 12:00 = afternoon
  });

  it("returns greet=false on the second call of the same day", () => {
    const db = openInMemoryDb();
    seedDevice(db, "d1");
    const s = createSession(db, { title: null });
    decideGreeting({ db, deviceId: "d1", sessionId: s.id, today: "2026-04-29", now: NOON });
    const r = decideGreeting({ db, deviceId: "d1", sessionId: s.id, today: "2026-04-29", now: NOON });
    expect(r.greet).toBe(false);
    expect(r.prefix).toBe("");
  });

  it("greets again the next day", () => {
    const db = openInMemoryDb();
    seedDevice(db, "d1");
    const s = createSession(db, { title: null });
    decideGreeting({ db, deviceId: "d1", sessionId: s.id, today: "2026-04-29", now: NOON });
    const r = decideGreeting({ db, deviceId: "d1", sessionId: s.id, today: "2026-04-30", now: NOON });
    expect(r.greet).toBe(true);
  });

  it("includes last session topic in the greeting context", () => {
    const db = openInMemoryDb();
    seedDevice(db, "d1");
    const yesterday = createSession(db, { title: "auth refactor" });
    appendMessage(db, { sessionId: yesterday.id, role: "user", content: "let's fix the auth tests" });
    const today = createSession(db, { title: "morning chat" });
    const r = decideGreeting({ db, deviceId: "d1", sessionId: today.id, today: "2026-04-29", now: NOON });
    expect(r.prefix).toContain("auth refactor");
    expect(r.prefix).toContain("auth tests");
  });

  it("falls back to first-conversation phrasing when no prior messages exist", () => {
    const db = openInMemoryDb();
    seedDevice(db, "d1");
    const s = createSession(db, { title: null });
    const r = decideGreeting({ db, deviceId: "d1", sessionId: s.id, today: "2026-04-29", now: NOON });
    expect(r.prefix).toContain("first conversation");
  });

  it("respects existing last_greeting_date row from earlier today", () => {
    const db = openInMemoryDb();
    seedDevice(db, "d1");
    markGreetingSent(db, "d1", "2026-04-29");
    const s = createSession(db, { title: null });
    const r = decideGreeting({ db, deviceId: "d1", sessionId: s.id, today: "2026-04-29", now: NOON });
    expect(r.greet).toBe(false);
  });

  it("suppresses the recap when the last message is fresh (<30min)", () => {
    const db = openInMemoryDb();
    seedDevice(db, "d1");
    const prev = createSession(db, { title: "weather check" });
    appendMessage(db, { sessionId: prev.id, role: "user", content: "check the weather" });
    const s = createSession(db, { title: null });
    // appendMessage stamps real Date.now(); 5 minutes later is still fresh.
    const r = decideGreeting({ db, deviceId: "d1", sessionId: s.id, today: "2026-04-29", now: Date.now() + 5 * 60_000 });
    expect(r.prefix).toContain("Do not recap");
    expect(r.prefix).not.toContain("left off");
  });

  it("offers the left-off recap only for stale threads (>30min)", () => {
    const db = openInMemoryDb();
    seedDevice(db, "d1");
    const prev = createSession(db, { title: "weather check" });
    appendMessage(db, { sessionId: prev.id, role: "user", content: "check the weather" });
    const s = createSession(db, { title: null });
    const r = decideGreeting({ db, deviceId: "d1", sessionId: s.id, today: "2026-04-29", now: Date.now() + 31 * 60_000 });
    expect(r.prefix).toContain("left off");
    expect(r.prefix).not.toContain("Do not recap");
  });

  it("uses morning/afternoon/evening based on hour", () => {
    const db = openInMemoryDb();
    seedDevice(db, "d1");
    const s = createSession(db, { title: null });
    const morning = decideGreeting({
      db, deviceId: "d1", sessionId: s.id, today: "2026-04-29",
      now: new Date("2026-04-29T08:00:00").getTime(),
    });
    expect(morning.prefix).toContain("morning");
  });
});
