import { describe, it, expect } from "vitest";
import { decideRollback } from "./watchdog.js";

describe("decideRollback", () => {
  it("does nothing when the new process becomes healthy", async () => {
    const actions: string[] = [];
    await decideRollback({
      checkHealth: async () => true, timeoutMs: 100, intervalMs: 10,
      rollback: async () => { actions.push("rollback"); },
    });
    expect(actions).toEqual([]);
  });

  it("rolls back when health never arrives", async () => {
    const actions: string[] = [];
    await decideRollback({
      checkHealth: async () => false, timeoutMs: 50, intervalMs: 10,
      rollback: async () => { actions.push("rollback"); },
    });
    expect(actions).toEqual(["rollback"]);
  });
});
