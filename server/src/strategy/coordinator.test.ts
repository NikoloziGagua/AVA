import { describe, expect, it, vi } from "vitest";
import { openInMemoryDb } from "../state/db.js";
import type { LLMProvider, StreamEvent, StreamInput } from "../orchestrator/llm/types.js";
import type { CodexConsultant } from "./codex-consultant.js";
import { StrategyRoomCoordinator } from "./coordinator.js";
import { StrategyRoomStore } from "./store.js";

function provider(): LLMProvider {
  let turn = 0;
  return {
    name: "openai",
    defaultOrchestratorModel: "test-model",
    defaultSideModel: "test-side",
    async *stream(_input: StreamInput): AsyncIterable<StreamEvent> {
      turn++;
      yield {
        kind: "delta",
        text: turn === 1
          ? "AVA position"
          : turn === 2
            ? "AVA cross-review"
            : "# Objective\nAgree on a plan\n# Recommended decision\nBuild reliability first\n# Proposed next steps\nReview with Niko\n\nAwaiting Niko's approval — no implementation has started.",
      };
      yield { kind: "done", stop_reason: "end_turn" };
    },
    complete: async () => "unused",
  };
}

function codex(): CodexConsultant {
  let turn = 0;
  return {
    probe: async () => ({ available: true, version: "codex-test", error: null }),
    consult: vi.fn(async (input) => {
      turn++;
      return {
        ok: true as const,
        text: turn === 1 ? "Codex critical review" : "Codex final recommendation",
        threadId: input.threadId ?? "thr_strategy",
        usage: { inputTokens: 10, cachedInputTokens: 5, outputTokens: 3 },
      };
    }),
  };
}

describe("StrategyRoomCoordinator", () => {
  it("runs an attributed bounded exchange and waits for Niko", async () => {
    const db = openInMemoryDb();
    const store = new StrategyRoomStore(db);
    const codexAdapter = codex();
    const coordinator = new StrategyRoomCoordinator({
      store,
      provider: provider(),
      codex: codexAdapter,
      repoRoot: "C:/repo",
    });
    const id = coordinator.create("What should AVA improve first?").room.id;
    await vi.waitFor(() => expect(store.getRoom(id)?.status).toBe("awaiting_niko"));

    const detail = store.getDetail(id)!;
    expect(detail.messages.map((message) => message.author)).toEqual([
      "niko", "ava", "codex", "ava", "codex", "ava",
    ]);
    expect(detail.room.codexThreadId).toBe("thr_strategy");
    expect(detail.room.livingBrief).toContain("Recommended decision");
    expect(codexAdapter.consult).toHaveBeenCalledTimes(2);
    expect(vi.mocked(codexAdapter.consult).mock.calls[1]?.[0].threadId).toBe("thr_strategy");
    db.close();
  });

  it("reopens an approved room when Niko adds context", async () => {
    const db = openInMemoryDb();
    const store = new StrategyRoomStore(db);
    const coordinator = new StrategyRoomCoordinator({ store, provider: provider(), codex: codex(), repoRoot: "C:/repo" });
    const id = coordinator.create("Initial topic").room.id;
    await vi.waitFor(() => expect(store.getRoom(id)?.status).toBe("awaiting_niko"));
    const before = store.getRoom(id)!;
    expect(coordinator.approve(id, before.version).ok).toBe(true);
    coordinator.addNikoMessage(id, "I want to change one assumption.");
    expect(store.getRoom(id)).toMatchObject({ status: "discussing", round: 2, approvedAt: null });
    await vi.waitFor(() => expect(store.getRoom(id)?.status).toBe("awaiting_niko"));
    expect(store.listMessages(id).some((message) => message.content.includes("change one assumption"))).toBe(true);
    db.close();
  });

  it("does not reopen a linked approved room before its conclusion is returned", () => {
    const db = openInMemoryDb();
    const store = new StrategyRoomStore(db);
    const coordinator = new StrategyRoomCoordinator({ store, provider: provider(), codex: codex(), repoRoot: "C:/repo" });
    const linked = store.createRoomFromChat({
      topic: "Choose a linked plan",
      context: "Niko: Choose a linked plan",
      sourceSessionId: "chat-linked",
      sourceThroughMessageId: 91,
    });
    const proposed = store.updateRoom(linked.detail.room.id, {
      status: "awaiting_niko",
      phase: "waiting_for_niko",
      activeActor: null,
      conclusion: "Use the approved plan.",
      livingBrief: "Use the approved plan.",
    });
    const approved = coordinator.approve(linked.detail.room.id, proposed.version);
    expect(approved.ok).toBe(true);
    if (!approved.ok) throw new Error("approval failed");

    expect(coordinator.resume(linked.detail.room.id, approved.room.version)).toMatchObject({
      ok: false,
      reason: "invalid_status",
      room: { status: "approved", returnedMessageId: null },
    });
    expect(store.getRoom(linked.detail.room.id)).toMatchObject({ status: "approved", conclusion: "Use the approved plan." });
    db.close();
  });
});
