import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type Db } from "../state/db.js";
import { createSession } from "../state/sessions.js";
import { createRule } from "../state/rules.js";
import { decide, getApproval, type Approval } from "../state/approvals.js";
import { buildPolicyHook, type PolicyEvent } from "./runtime.js";

let db: Db;
let sessionId: string;
beforeEach(() => {
  db = openDb(join(mkdtempSync(join(tmpdir(), "ava-pol-rt-")), "x.db"));
  sessionId = createSession(db, { title: "t" }).id;
});

describe("buildPolicyHook", () => {
  it("read-only tool → allow", async () => {
    const hook = buildPolicyHook({ db, sessionId, emit: () => {} });
    const r = await hook("fs_read", { path: "C:/ai/x" });
    expect(r).toEqual({ allow: true });
  });

  it(".env path → blocked with message", async () => {
    const events: PolicyEvent[] = [];
    const hook = buildPolicyHook({ db, sessionId, emit: (e) => events.push(e) });
    const r = await hook("fs_read", { path: "C:/ai/.env" });
    expect(r.allow).toBe(false);
    if (!r.allow) expect(r.message).toMatch(/BLOCKED/);
    expect(events.length).toBe(0); // no approval flow
  });

  it("medium tool with no rules → emits approval_required, awaits, approves", async () => {
    const events: PolicyEvent[] = [];
    const hook = buildPolicyHook({
      db, sessionId,
      emit: (e) => {
        events.push(e);
        if (e.kind === "approval_required") {
          // Approve asynchronously after a tick.
          setTimeout(() => decide(db, e.payload.id, "approved"), 5);
        }
      },
    });
    const r = await hook("claude_code", { prompt: "fix" });
    expect(r).toEqual({ allow: true });
    expect(events.map((e) => e.kind)).toEqual(["approval_required", "approval_resolved"]);
    const resolved = events.find((e) => e.kind === "approval_resolved")!;
    if (resolved.kind === "approval_resolved") expect(resolved.payload.status).toBe("approved");
  });

  it("denied approval → returns blocked with DENIED message", async () => {
    const events: PolicyEvent[] = [];
    const hook = buildPolicyHook({
      db, sessionId,
      emit: (e) => {
        events.push(e);
        if (e.kind === "approval_required") setTimeout(() => decide(db, e.payload.id, "denied"), 5);
      },
    });
    // Destructive shell still classifies "high" → ask, so the approval flow runs.
    const r = await hook("shell", { command: "rm -rf /tmp/x" });
    expect(r.allow).toBe(false);
    if (!r.allow) expect(r.message).toMatch(/DENIED \(denied\)/);
  });

  it("undecided MEDIUM op auto-approves after the veto window elapses (convenience)", async () => {
    const events: PolicyEvent[] = [];
    const hook = buildPolicyHook({
      db, sessionId,
      emit: (e) => events.push(e),
      approvalTimeoutMs: 50, // tiny veto window for the test
    });
    // claude_code classifies "medium" → ask; an undecided medium op auto-approves.
    const r = await hook("claude_code", { prompt: "edit a file" });
    expect(r).toEqual({ allow: true });
    const resolved = events.find((e) => e.kind === "approval_resolved");
    expect(resolved?.kind === "approval_resolved" && resolved.payload.status).toBe("approved");
  });

  // ── Item 5: genuinely destructive HIGH-risk ops AUTO-DENY on timeout ──────
  it("undecided HIGH-risk op auto-DENIES after the veto window (not allow)", async () => {
    const events: PolicyEvent[] = [];
    const hook = buildPolicyHook({
      db, sessionId,
      emit: (e) => events.push(e),
      approvalTimeoutMs: 50,
    });
    // rm -rf classifies "high" — if Sir is away it must be CANCELLED, not run.
    const r = await hook("shell", { command: "rm -rf /tmp/x" });
    expect(r.allow).toBe(false);
    if (!r.allow) expect(r.message).toMatch(/DENIED \(expired\)/);
    const resolved = events.find((e) => e.kind === "approval_resolved");
    expect(resolved?.kind === "approval_resolved" && resolved.payload.status).toBe("expired");
  });

  it("undecided HIGH-risk fs_delete auto-DENIES on timeout", async () => {
    const hook = buildPolicyHook({ db, sessionId, emit: () => {}, approvalTimeoutMs: 50 });
    const r = await hook("fs_delete", { path: "C:/ai/important.txt" });
    expect(r.allow).toBe(false);
    if (!r.allow) expect(r.message).toMatch(/DENIED \(expired\)/);
  });

  it("undecided HIGH-risk submit/checkout click auto-DENIES on timeout", async () => {
    const hook = buildPolicyHook({ db, sessionId, emit: () => {}, approvalTimeoutMs: 50 });
    const r = await hook("chrome_click", { selector: "button[type='submit']" });
    expect(r.allow).toBe(false);
    if (!r.allow) expect(r.message).toMatch(/DENIED \(expired\)/);
  });

  it("HIGH-risk op still RUNS if Sir explicitly approves within the window", async () => {
    const hook = buildPolicyHook({
      db, sessionId,
      emit: (e) => { if (e.kind === "approval_required") setTimeout(() => decide(db, e.payload.id, "approved"), 5); },
      approvalTimeoutMs: 5_000,
    });
    // Auto-deny is only the TIMEOUT behaviour; an explicit approval still allows.
    const r = await hook("shell", { command: "rm -rf /tmp/x" });
    expect(r).toEqual({ allow: true });
  });

  it("Stop during the veto window cancels (not allow): aborting the signal blocks the tool", async () => {
    const events: PolicyEvent[] = [];
    const ac = new AbortController();
    const hook = buildPolicyHook({
      db, sessionId,
      emit: (e) => {
        events.push(e);
        // Press Stop while the approval is pending (long veto window otherwise
        // auto-approves). The abort must resolve it as expired → not allowed.
        if (e.kind === "approval_required") setTimeout(() => ac.abort(), 10);
      },
      approvalTimeoutMs: 5_000,
      signal: ac.signal,
    });
    const r = await hook("shell", { command: "rm -rf /tmp/x" });
    expect(r.allow).toBe(false);
    if (!r.allow) expect(r.message).toMatch(/DENIED \(expired\)/);
    const resolved = events.find((e) => e.kind === "approval_resolved");
    expect(resolved?.kind === "approval_resolved" && resolved.payload.status).toBe("expired");
  });

  it("active deny rule short-circuits to blocked without approval", async () => {
    createRule(db, {
      source: "no shell",
      parsed: JSON.stringify({ match: { tool: "shell" }, action: "deny" }),
      status: "active",
    });
    const events: PolicyEvent[] = [];
    const hook = buildPolicyHook({ db, sessionId, emit: (e) => events.push(e) });
    const r = await hook("shell", { command: "ls" });
    expect(r.allow).toBe(false);
    if (!r.allow) expect(r.message).toMatch(/BLOCKED/);
    expect(events.length).toBe(0);
  });

  it("calls pushDeliver when approval required, swallows push errors", async () => {
    const pushDeliver = vi.fn(async () => { throw new Error("boom"); });
    const hook = buildPolicyHook({
      db, sessionId,
      emit: (e) => {
        if (e.kind === "approval_required") setTimeout(() => decide(db, e.payload.id, "approved"), 5);
      },
      pushDeliver,
    });
    const r = await hook("claude_code", { prompt: "fix" });
    expect(r.allow).toBe(true);
    expect(pushDeliver).toHaveBeenCalledTimes(1);
    const arg = (pushDeliver.mock.calls as unknown as Approval[][])[0]![0]!;
    expect(arg.session_id).toBe(sessionId);
    expect(arg.tool).toBe("claude_code");
  });

  it("creates an approvals row in DB and the row's summary contains the tool name", async () => {
    let approvalId = "";
    const hook = buildPolicyHook({
      db, sessionId,
      emit: (e) => {
        if (e.kind === "approval_required") {
          approvalId = e.payload.id;
          setTimeout(() => decide(db, e.payload.id, "approved"), 5);
        }
      },
    });
    await hook("claude_code", { prompt: "do thing" });
    const row = getApproval(db, approvalId);
    expect(row).toBeTruthy();
    expect(row?.tool).toBe("claude_code");
    expect(row?.summary).toContain("claude_code");
  });
});
