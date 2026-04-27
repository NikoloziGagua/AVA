import { describe, it, expect } from "vitest";
import { runShell } from "./shell.js";

describe("runShell", () => {
  it("executes an allowlisted command", async () => {
    const r = await runShell({ command: "echo hello", timeoutMs: 5000 });
    expect(r.ok).toBe(true);
    expect(r.stdout.trim()).toBe("hello");
  });

  it("rejects a non-allowlisted command", async () => {
    const r = await runShell({ command: "rm -rf .", timeoutMs: 5000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/allowlist/);
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
});
