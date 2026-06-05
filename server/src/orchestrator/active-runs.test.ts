import { describe, it, expect } from "vitest";
import { ActiveRuns, type ActiveRun } from "./active-runs.js";

function fakeRun(sessionId: string): ActiveRun {
  return { sessionId, abort: new AbortController(), buffer: {} } as unknown as ActiveRun;
}

describe("ActiveRuns", () => {
  it("registers and reads back a run by session", () => {
    const runs = new ActiveRuns();
    const r = fakeRun("s1");
    runs.register(r);
    expect(runs.get("s1")).toBe(r);
  });

  it("abort() signals the controller and reports whether one was active", () => {
    const runs = new ActiveRuns();
    const r = fakeRun("s1");
    runs.register(r);
    expect(r.abort.signal.aborted).toBe(false);
    expect(runs.abort("s1")).toBe(true);
    expect(r.abort.signal.aborted).toBe(true);
    expect(runs.abort("missing")).toBe(false);
  });

  it("force-unregister (no run arg) frees the slot — used by kill/preempt", () => {
    const runs = new ActiveRuns();
    runs.register(fakeRun("s1"));
    runs.unregister("s1");
    expect(runs.get("s1")).toBeUndefined();
  });

  it("identity-safe unregister does NOT evict a newer run that took the slot", () => {
    const runs = new ActiveRuns();
    const oldRun = fakeRun("s1");
    runs.register(oldRun);
    // preempt: old run force-removed, a new command registers on the same session
    runs.unregister("s1");
    const newRun = fakeRun("s1");
    runs.register(newRun);
    // the OLD run's finally fires late carrying its own identity — must be a no-op
    runs.unregister("s1", oldRun);
    expect(runs.get("s1")).toBe(newRun);
  });

  it("identity unregister with the matching run clears it", () => {
    const runs = new ActiveRuns();
    const r = fakeRun("s1");
    runs.register(r);
    runs.unregister("s1", r);
    expect(runs.get("s1")).toBeUndefined();
  });
});
