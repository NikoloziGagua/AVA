import { describe, expect, it } from "vitest";
import { openInMemoryDb } from "../state/db.js";
import { appendMessage, listMessages } from "../state/messages.js";
import { createSession } from "../state/sessions.js";
import { StrategyRoomStore } from "./store.js";

describe("StrategyRoomStore", () => {
  it("persists attributed messages and redacts secrets before storage", () => {
    const db = openInMemoryDb();
    const store = new StrategyRoomStore(db);
    const created = store.createRoom("Plan an AVA improvement");
    store.appendMessage(created.room.id, {
      author: "codex",
      kind: "review",
      content: "authorization: Bearer definitely-secret-token",
    });

    const detail = store.getDetail(created.room.id)!;
    expect(detail.messages.map((message) => message.author)).toEqual(["niko", "codex"]);
    expect(JSON.stringify(detail)).not.toContain("definitely-secret-token");
    expect(JSON.stringify(detail)).toContain("***");
    expect(store.eventsAfter(0).length).toBeGreaterThanOrEqual(3);
    db.close();
  });

  it("uses a version guard and only approves a proposed conclusion", () => {
    const db = openInMemoryDb();
    const store = new StrategyRoomStore(db);
    const id = store.createRoom("Choose a plan").room.id;
    const discussing = store.getRoom(id)!;
    expect(store.approve(id, discussing.version)).toMatchObject({ ok: false, reason: "invalid_status" });

    const proposed = store.updateRoom(id, {
      status: "awaiting_niko",
      phase: "waiting_for_niko",
      activeActor: null,
      conclusion: "Use the reliability kernel.",
      livingBrief: "Use the reliability kernel.",
    });
    expect(store.approve(id, proposed.version - 1)).toMatchObject({ ok: false, reason: "stale_version" });
    const approved = store.approve(id, proposed.version);
    expect(approved).toMatchObject({ ok: true, room: { status: "approved", phase: "approved" } });
    expect(store.listMessages(id).at(-1)?.content).toContain("no implementation was started");
    db.close();
  });

  it("reconciles a discussion interrupted by restart to a truthful paused state", () => {
    const db = openInMemoryDb();
    const store = new StrategyRoomStore(db);
    const id = store.createRoom("Long discussion").room.id;
    expect(store.failInterruptedRooms()).toBe(1);
    expect(store.getRoom(id)).toMatchObject({
      status: "paused",
      phase: "paused",
      activeActor: null,
      error: "interrupted by a server restart",
    });
    db.close();
  });

  it("links one room per chat snapshot and returns an approved conclusion exactly once", () => {
    const db = openInMemoryDb();
    const store = new StrategyRoomStore(db);
    const session = createSession(db, { title: "A linked decision" });
    const source = appendMessage(db, { sessionId: session.id, role: "user", content: "Choose a direction" });
    const input = {
      topic: "Choose a direction",
      context: "Niko: Choose a direction\nAuthorization: Bearer secret-room-token",
      sourceSessionId: session.id,
      sourceThroughMessageId: source.id,
    };
    const first = store.createRoomFromChat(input);
    const replay = store.createRoomFromChat(input);

    expect(replay.reused).toBe(true);
    expect(replay.detail.room.id).toBe(first.detail.room.id);
    expect(store.listRooms()).toHaveLength(1);
    expect(JSON.stringify(first.detail)).not.toContain("secret-room-token");

    const proposed = store.updateRoom(first.detail.room.id, {
      status: "awaiting_niko",
      phase: "waiting_for_niko",
      activeActor: null,
      conclusion: "Use the bounded bridge.",
      livingBrief: "Use the bounded bridge.",
    });
    expect(store.returnConclusionToChat(first.detail.room.id, proposed.version)).toMatchObject({
      ok: false,
      reason: "invalid_status",
    });
    const approved = store.approve(first.detail.room.id, proposed.version);
    expect(approved.ok).toBe(true);
    if (!approved.ok) throw new Error("approval failed");

    const returned = store.returnConclusionToChat(first.detail.room.id, approved.room.version);
    expect(returned).toMatchObject({ ok: true, sessionId: session.id, idempotent: false });
    if (!returned.ok) throw new Error("return failed");
    const replayedReturn = store.returnConclusionToChat(first.detail.room.id, approved.room.version);
    expect(replayedReturn).toMatchObject({
      ok: true,
      messageId: returned.messageId,
      idempotent: true,
    });
    const chat = listMessages(db, session.id);
    expect(chat).toHaveLength(2);
    expect(chat.at(-1)).toMatchObject({ role: "assistant" });
    expect(chat.at(-1)?.content).toContain("proposed course of action (not executed)");
    expect(chat.at(-1)?.content).toContain("Tell me what course of action");
    db.close();
  });
});
