import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "./db.js";
import { createSession } from "./sessions.js";
import { appendMessage, countMessages, listMessages, listMessagesAfterId } from "./messages.js";

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

  it("round-trips the bounded exact-text voice provenance and drops unknown metadata", () => {
    const stored = appendMessage(db, {
      sessionId,
      role: "user",
      content: "@Exact_Name",
      metadata: { inputSource: "voice_exact_text" },
    });
    db.prepare("UPDATE messages SET metadata = ? WHERE id = ?").run(
      JSON.stringify({ inputSource: "voice_exact_text", secretPayload: "must-not-surface" }),
      stored.id,
    );
    expect(listMessages(db, sessionId)[0]?.metadata).toEqual({ inputSource: "voice_exact_text" });
  });

  it("round-trips only a bounded sanitized memory receipt beside existing metadata", () => {
    const stored = appendMessage(db, {
      sessionId,
      role: "assistant",
      content: "I used the saved plan.",
      metadata: {
        visualMessages: [{ visualMessageId: "visual_saved001", revision: 2 }],
        memoryContext: {
          schemaVersion: 1,
          status: "used",
          reason: "A relevant source-verified checkpoint matched. token=unsafe-value",
          project: "Aurora",
          mode: "hybrid",
          semanticAvailable: true,
          notice: null,
          selected: [{
            entryId: "memory_checkpoint_01",
            title: "Aurora plan password=unsafe-value",
            kind: "idea",
            project: "Aurora",
            sourceStatus: "verified",
            matchMode: "hybrid",
            matchReason: "Matched the plan topic.",
            sourceTruncated: false,
          }],
        },
      },
    });
    const row = db.prepare("SELECT metadata FROM messages WHERE id = ?").get(stored.id) as { metadata: string };
    expect(row.metadata).not.toContain("unsafe-value");
    const memory = listMessages(db, sessionId)[0]?.metadata?.memoryContext;
    expect(memory).toMatchObject({ status: "used", selected: [{ entryId: "memory_checkpoint_01" }] });
    expect(listMessages(db, sessionId)[0]?.metadata?.visualMessages).toHaveLength(1);
    expect(JSON.stringify(memory)).not.toContain("query");
    expect(JSON.stringify(memory)).not.toContain("prompt");
  });

  it("drops malformed or unsupported memory claims on read", () => {
    const stored = appendMessage(db, { sessionId, role: "assistant", content: "No claim." });
    db.prepare("UPDATE messages SET metadata = ? WHERE id = ?").run(JSON.stringify({
      memoryContext: {
        schemaVersion: 1,
        status: "used",
        reason: "Claims a source but carries none.",
        project: null,
        mode: "semantic",
        semanticAvailable: true,
        notice: null,
        selected: [],
        query: "private query",
        sourceExcerpt: "private transcript",
      },
    }), stored.id);
    expect(listMessages(db, sessionId)[0]?.metadata).toEqual({});
  });

  it("isolates by session_id", () => {
    const otherSession = createSession(db, { title: null }).id;
    appendMessage(db, { sessionId, role: "user", content: "mine" });
    appendMessage(db, { sessionId: otherSession, role: "user", content: "other" });
    const list = listMessages(db, sessionId);
    expect(list).toHaveLength(1);
    expect(list[0]?.content).toBe("mine");
  });

  it("countMessages returns total messages for session", () => {
    expect(countMessages(db, sessionId)).toBe(0);
    appendMessage(db, { sessionId, role: "user", content: "1" });
    appendMessage(db, { sessionId, role: "assistant", content: "2" });
    expect(countMessages(db, sessionId)).toBe(2);
    const otherSession = createSession(db, { title: null }).id;
    appendMessage(db, { sessionId: otherSession, role: "user", content: "x" });
    expect(countMessages(db, sessionId)).toBe(2);
    expect(countMessages(db, otherSession)).toBe(1);
  });

  it("listMessagesAfterId returns only messages with id > afterId", () => {
    const m1 = appendMessage(db, { sessionId, role: "user", content: "1" });
    const m2 = appendMessage(db, { sessionId, role: "assistant", content: "2" });
    const m3 = appendMessage(db, { sessionId, role: "user", content: "3" });
    const after = listMessagesAfterId(db, sessionId, m1.id);
    expect(after.map((m) => m.id)).toEqual([m2.id, m3.id]);
    const afterAll = listMessagesAfterId(db, sessionId, m3.id);
    expect(afterAll).toEqual([]);
  });
});
