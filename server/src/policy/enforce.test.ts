import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type Db } from "../state/db.js";
import { createRule, updateRule } from "../state/rules.js";
import { enforce } from "./enforce.js";

let db: Db;
beforeEach(() => {
  db = openDb(join(mkdtempSync(join(tmpdir(), "ava-enforce-")), "x.db"));
});

describe("enforce", () => {
  it("read-only tool → allow", () => {
    expect(enforce({ tool: "fs_read", args: { path: "C:/ai/x" }, db }).decision).toBe("allow");
  });

  it("low tool → allow", () => {
    expect(enforce({ tool: "fs_write", args: { path: "C:/ai/x.txt" }, db }).decision).toBe("allow");
  });

  it("medium tool with no rules → ask", () => {
    const r = enforce({ tool: "claude_code", args: { prompt: "fix it" }, db });
    expect(r.decision).toBe("ask");
    if (r.decision === "ask") expect(r.tier).toBe("medium");
  });

  it("high tool with no rules → ask", () => {
    const r = enforce({ tool: "shell", args: { command: "rm -rf /tmp/x" }, db });
    expect(r.decision).toBe("ask");
    if (r.decision === "ask") expect(r.tier).toBe("high");
  });

  it(".env hard-block beats any allow rule", () => {
    createRule(db, {
      source: "always allow shell",
      parsed: JSON.stringify({ match: { tool: "shell" }, action: "allow" }),
      status: "active",
    });
    const r = enforce({ tool: "shell", args: { command: "cat /project/.env" }, db });
    expect(r.decision).toBe("blocked");
  });

  it("medium tool with matching allow rule → allow", () => {
    createRule(db, {
      source: "claude_code is fine in /ai",
      parsed: JSON.stringify({ match: { tool: "claude_code" }, action: "allow" }),
      status: "active",
    });
    const r = enforce({ tool: "claude_code", args: { prompt: "fix" }, db });
    expect(r.decision).toBe("allow");
  });

  it("low tool with matching deny rule → blocked with rule reason", () => {
    createRule(db, {
      source: "no fs writes outside C:/work",
      parsed: JSON.stringify({ match: { tool: "fs_write" }, action: "deny" }),
      status: "active",
    });
    const r = enforce({ tool: "fs_write", args: { path: "C:/ai/x.txt" }, db });
    expect(r.decision).toBe("blocked");
    if (r.decision === "blocked") expect(r.reason).toMatch(/no fs writes outside/);
  });

  it("disabled rule is ignored", () => {
    const rule = createRule(db, {
      source: "deny shell",
      parsed: JSON.stringify({ match: { tool: "shell" }, action: "deny" }),
      status: "active",
    });
    updateRule(db, rule.id, { enabled: false });
    const r = enforce({ tool: "shell", args: { command: "ls" }, db });
    expect(r.decision).toBe("ask");
  });

  it("pending-status rule is ignored", () => {
    createRule(db, {
      source: "pending rule",
      parsed: JSON.stringify({ match: { tool: "shell" }, action: "deny" }),
      status: "pending",
    });
    const r = enforce({ tool: "shell", args: { command: "ls" }, db });
    expect(r.decision).toBe("ask");
  });

  it("classifier-blocked beats matching allow rule for --dangerously-skip-permissions", () => {
    createRule(db, {
      source: "claude_code allowed",
      parsed: JSON.stringify({ match: { tool: "claude_code" }, action: "allow" }),
      status: "active",
    });
    const r = enforce({ tool: "claude_code", args: { prompt: "--dangerously-skip-permissions" }, db });
    expect(r.decision).toBe("blocked");
  });
});
