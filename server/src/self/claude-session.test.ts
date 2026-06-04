import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getClaudeSession, markClaudeSessionStarted } from "./claude-session.js";

function dir() { return mkdtempSync(join(tmpdir(), "ava-cs-")); }

describe("claude session store", () => {
  it("creates a stable UUID, resume=false on first use", () => {
    const d = dir();
    const a = getClaudeSession(d);
    expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.resume).toBe(false);
    // Same id on a second read, still not started.
    expect(getClaudeSession(d)).toEqual(a);
  });

  it("resumes the SAME id once the session is marked started", () => {
    const d = dir();
    const first = getClaudeSession(d);
    markClaudeSessionStarted(d);
    const next = getClaudeSession(d);
    expect(next.id).toBe(first.id);
    expect(next.resume).toBe(true);
  });

  it("markStarted is a no-op when no session exists yet", () => {
    const d = dir();
    expect(() => markClaudeSessionStarted(d)).not.toThrow();
  });
});
