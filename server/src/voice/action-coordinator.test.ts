import { describe, expect, it } from "vitest";
import { VoiceActionCoordinator } from "./action-coordinator.js";

describe("VoiceActionCoordinator", () => {
  it("aborts and retires an interrupted run", () => {
    const actions = new VoiceActionCoordinator();
    const run = actions.begin();
    expect(actions.active).toBe(true);
    expect(actions.cancel()).toBe(true);
    expect(run.signal.aborted).toBe(true);
    expect(actions.isCurrent(run.id)).toBe(false);
    expect(actions.active).toBe(false);
  });

  it("makes a replaced action stale so its late result is ignored", () => {
    const actions = new VoiceActionCoordinator();
    const first = actions.begin();
    const second = actions.begin();
    expect(first.signal.aborted).toBe(true);
    expect(actions.isCurrent(first.id)).toBe(false);
    expect(actions.isCurrent(second.id)).toBe(true);
    expect(actions.finish(second.id)).toBe(true);
  });
});
