import { afterEach, describe, expect, it, vi } from "vitest";
import {
  VOICE_MEMORY_BUDGET_MS,
  VOICE_RECALL_BUDGET_MS,
  voiceMemoryBudgetMs,
  withinBudget,
} from "./voice-memory-budget.js";

afterEach(() => { vi.useRealTimers(); });

describe("voice memory budget", () => {
  it("waits longer only when Sir explicitly asks AVA to recall something", () => {
    expect(voiceMemoryBudgetMs("what's the weather like")).toBe(VOICE_MEMORY_BUDGET_MS);
    expect(voiceMemoryBudgetMs("remind me in two minutes to hang my clothes")).toBe(VOICE_MEMORY_BUDGET_MS);
    expect(voiceMemoryBudgetMs("do you remember what we decided about the thesis")).toBe(VOICE_RECALL_BUDGET_MS);
    expect(VOICE_MEMORY_BUDGET_MS).toBeLessThan(VOICE_RECALL_BUDGET_MS);
  });

  it("returns the memory when it arrives within the budget", async () => {
    const outcome = await withinBudget(Promise.resolve("memory"), 50);
    expect(outcome).toMatchObject({ status: "ready", value: "memory" });
  });

  it("stops waiting at the budget without cancelling the lookup", async () => {
    vi.useFakeTimers();
    let finishLookup!: (value: string) => void;
    const lookup = new Promise<string>((resolve) => { finishLookup = resolve; });
    let clock = 0;
    const pending = withinBudget(lookup, 350, () => clock);
    clock = 350;
    await vi.advanceTimersByTimeAsync(350);
    await expect(pending).resolves.toEqual({ status: "late", elapsedMs: 350 });
    // The lookup still completes for the record; it just no longer blocks the reply.
    finishLookup("late memory");
    await expect(lookup).resolves.toBe("late memory");
  });

  it("reports a failed lookup without throwing, so the reply still starts", async () => {
    const outcome = await withinBudget(Promise.reject(new Error("embedding down")), 50);
    expect(outcome.status).toBe("failed");
    expect((outcome as { error: Error }).error.message).toBe("embedding down");
  });

  it("settles exactly once when the lookup lands right at the deadline", async () => {
    vi.useFakeTimers();
    let finishLookup!: (value: string) => void;
    const pending = withinBudget(new Promise<string>((resolve) => { finishLookup = resolve; }), 100);
    await vi.advanceTimersByTimeAsync(100);
    finishLookup("too late");
    await expect(pending).resolves.toMatchObject({ status: "late" });
  });
});
