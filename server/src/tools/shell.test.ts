import { describe, it, expect } from "vitest";
import { runShell } from "./shell.js";

describe("runShell", () => {
  it("executes an allowlisted command", async () => {
    const r = await runShell({ command: "echo hello", timeoutMs: 5000 });
    expect(r.ok).toBe(true);
    expect(r.stdout.trim()).toBe("hello");
  });

  it("rejects a destructive command", async () => {
    const r = await runShell({ command: "rm -rf .", timeoutMs: 5000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/destructive/i);
  });

  it("rejects a .env access attempt", async () => {
    const r = await runShell({ command: "cat .env", timeoutMs: 5000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/\.env/);
  });

  it("times out long-running processes", async () => {
    const r = await runShell({ command: "node", timeoutMs: 200 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/timeout/i);
  });

  it("registers the child PID on spawn and unregisters it on exit", async () => {
    // This is what lets the Stop button's killTree() loop reach a shell child.
    const spawned: number[] = [];
    const exited: number[] = [];
    const r = await runShell({
      command: "echo hi",
      timeoutMs: 5000,
      onSpawn: (pid) => spawned.push(pid),
      onExit: (pid) => exited.push(pid),
    });
    expect(r.ok).toBe(true);
    expect(spawned.length).toBe(1);
    expect(spawned[0]).toBeGreaterThan(0);
    expect(exited).toEqual(spawned); // same PID unregistered after the run settles
  });
});
