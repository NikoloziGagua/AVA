import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "./db.js";
import { createSession } from "./sessions.js";
import {
  appendMessage,
  countMessages,
  listMessages,
  listMessagesAfterId,
  sanitizeMessageSavedItems,
  sanitizeMessageRoomPosts,
} from "./messages.js";

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

  it("round-trips bounded modality/recovery metadata and rejects malformed values on write/read", () => {
    appendMessage(db, { sessionId, role: "user", content: "exact", metadata: { inputSource: "voice_exact_text", inputModality: "text" } });
    appendMessage(db, { sessionId, role: "system", content: "restart", metadata: { interruptedTaskId: "task:123" } });
    const invalid = appendMessage(db, { sessionId, role: "user", content: "invalid", metadata: { inputModality: "other", interruptedTaskId: "x".repeat(161) } as never });
    expect(invalid.metadata).toEqual({});
    db.prepare("UPDATE messages SET metadata = ? WHERE id = ?").run('{"inputModality":"other","interruptedTaskId":"secret\\ncontent"}', invalid.id);
    expect(listMessages(db, sessionId).map(m => m.metadata)).toEqual([
      { inputSource: "voice_exact_text", inputModality: "text" }, { interruptedTaskId: "task:123" }, {},
    ]);
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

  it("round-trips a Saved receipt and re-validates it on read", () => {
    const savedItems = {
      schemaVersion: 1 as const,
      items: [
        { kind: "note" as const, id: "note_abc123", title: "Thesis outline" },
        { kind: "reminder" as const, id: "w_9", title: "Hang the clothes" },
      ],
    };
    const stored = appendMessage(db, { sessionId, role: "assistant", content: "Done.", metadata: { savedItems } });
    expect(stored.metadata?.savedItems).toEqual(savedItems);
    expect(listMessages(db, sessionId)[0]!.metadata?.savedItems).toEqual(savedItems);

    // A tampered row cannot smuggle an unknown kind or an unsafe id into the UI.
    db.prepare("UPDATE messages SET metadata = ? WHERE id = ?").run(JSON.stringify({
      savedItems: { schemaVersion: 1, items: [{ kind: "script", id: "x", title: "t" }, { kind: "note", id: "../etc", title: "t" }] },
    }), stored.id);
    expect(listMessages(db, sessionId)[0]!.metadata).toEqual({});
  });

  it("round-trips only bounded sanitized room post receipts", () => {
    const roomPosts = {
      schemaVersion: 1 as const,
      items: [{ schemaVersion: 1 as const, messageId: 47, roomName: "klevar", correlationId: "run:abc_123", postedAt: 1234 }],
    };
    const stored = appendMessage(db, { sessionId, role: "assistant", content: "Posted.", metadata: { roomPosts } });
    expect(stored.metadata?.roomPosts).toEqual(roomPosts);
    expect(listMessages(db, sessionId)[0]?.metadata?.roomPosts).toEqual(roomPosts);

    db.prepare("UPDATE messages SET metadata = ? WHERE id = ?").run(JSON.stringify({
      roomPosts: { schemaVersion: 1, items: [{ schemaVersion: 1, messageId: 48, roomName: "token=secret-value", correlationId: "../bad", postedAt: 1235 }] },
    }), stored.id);
    expect(listMessages(db, sessionId)[0]?.metadata).toEqual({});
  });
});

describe("sanitizeMessageSavedItems", () => {
  it("keeps valid items in order, dedupes, caps at six and scrubs titles", () => {
    const items = [
      { kind: "idea", id: "n1", title: "  Solar   kiln  idea " },
      { kind: "idea", id: "n1", title: "duplicate" },
      { kind: "memory", id: "file:preferences", title: "Prefers tea" },
      ...Array.from({ length: 8 }, (_, i) => ({ kind: "watch", id: `w${i}`, title: `Watch ${i}` })),
    ];
    const receipt = sanitizeMessageSavedItems({ schemaVersion: 1, items });
    expect(receipt?.items).toHaveLength(6);
    expect(receipt?.items[0]).toEqual({ kind: "idea", id: "n1", title: "Solar kiln idea" });
    expect(receipt?.items[1]).toEqual({ kind: "memory", id: "file:preferences", title: "Prefers tea" });
    const long = sanitizeMessageSavedItems({ schemaVersion: 1, items: [{ kind: "note", id: "n2", title: "x".repeat(300) }] });
    expect(long?.items[0]!.title).toHaveLength(120);
    const secret = sanitizeMessageSavedItems({ schemaVersion: 1, items: [{ kind: "note", id: "n3", title: "key sk-proj-abcdefghijklmnopqrstuvwxyz0123456789" }] });
    expect(secret?.items[0]!.title).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
  });

  it("rejects malformed receipts", () => {
    expect(sanitizeMessageSavedItems(null)).toBeNull();
    expect(sanitizeMessageSavedItems({ schemaVersion: 2, items: [{ kind: "note", id: "n", title: "t" }] })).toBeNull();
    expect(sanitizeMessageSavedItems({ schemaVersion: 1, items: [] })).toBeNull();
    expect(sanitizeMessageSavedItems({ schemaVersion: 1, items: [{ kind: "note", id: "n", title: "   " }] })).toBeNull();
    expect(sanitizeMessageSavedItems({ schemaVersion: 1, items: [{ kind: "note", id: "", title: "t" }] })).toBeNull();
  });
});

describe("sanitizeMessageRoomPosts", () => {
  it("dedupes, caps at three and scrubs room labels", () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      schemaVersion: 1, messageId: i + 1,
      roomName: i === 0 ? "dev token=unsafe-value" : "dev",
      correlationId: `run_${i}`,
      postedAt: i + 100,
    }));
    items.splice(1, 0, items[0]!);
    const receipt = sanitizeMessageRoomPosts({ schemaVersion: 1, items });
    expect(receipt?.items).toHaveLength(3);
    expect(receipt?.items[0]?.roomName).not.toContain("unsafe-value");
  });

  it("rejects malformed or empty receipts", () => {
    expect(sanitizeMessageRoomPosts(null)).toBeNull();
    expect(sanitizeMessageRoomPosts({ schemaVersion: 1, items: [] })).toBeNull();
    expect(sanitizeMessageRoomPosts({ schemaVersion: 1, items: [{ schemaVersion: 1, messageId: 0, roomName: "x", correlationId: "run", postedAt: 1 }] })).toBeNull();
  });
});
