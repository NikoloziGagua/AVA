import { describe, expect, it } from "vitest";
import { openInMemoryDb } from "../state/db.js";
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
});
