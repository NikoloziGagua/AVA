import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildClaudeCode, defaultClaudeArgs, workerEnv, sessionArgs } from "./claude-code.js";
import { PidfileRegistry } from "../process/pidfile.js";
import { buildPathAllowlist } from "../security/path-allowlist.js";

describe("defaultClaudeArgs", () => {
  it("runs non-interactively and auto-accepts file edits so the worker can edit code", () => {
    const args = defaultClaudeArgs("do X", "/cwd");
    expect(args).toContain("-p");
    expect(args.join(" ")).toContain("--permission-mode acceptEdits");
    expect(args.join(" ")).not.toContain("dangerously-skip-permissions");
  });
  it("passes the model through when given", () => {
    expect(defaultClaudeArgs("p", "/c", "sonnet")).toEqual(["-p", "p", "--permission-mode", "acceptEdits", "--model", "sonnet"]);
  });
});

describe("workerEnv", () => {
  it("strips API-key overrides so the worker uses the subscription login", () => {
    const e = workerEnv({ ANTHROPIC_API_KEY: "sk-x", ANTHROPIC_AUTH_TOKEN: "t", PATH: "/usr/bin", FOO: "bar" });
    expect(e.ANTHROPIC_API_KEY).toBeUndefined();
    expect(e.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(e.PATH).toBe("/usr/bin");
    expect(e.FOO).toBe("bar");
  });
});

describe("sessionArgs", () => {
  it("creates the session on first use (--session-id), resumes it after (--resume)", () => {
    expect(sessionArgs({ id: "abc", resume: false })).toEqual(["--session-id", "abc"]);
    expect(sessionArgs({ id: "abc", resume: true })).toEqual(["--resume", "abc"]);
  });
  it("adds nothing when there's no session", () => {
    expect(sessionArgs(undefined)).toEqual([]);
  });
});

describe("claude_code tool", () => {
  let root: string;
  let pidDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ava-cc-"));
    pidDir = mkdtempSync(join(tmpdir(), "ava-cc-pids-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(pidDir, { recursive: true, force: true });
  });

  function build() {
    return buildClaudeCode({
      pidfiles: new PidfileRegistry(pidDir),
      check: buildPathAllowlist({ roots: [`${root.replace(/\\/g, "/")}/**`] }),
      // For tests, replace `claude` with a node script that just prints the prompt back.
      claudeBinary: process.execPath,
      claudeArgs: (prompt, cwd) => ["-e", `console.log(${JSON.stringify(`MOCK ${prompt} ${cwd}`)})`],
    });
  }

  it("denies cwd outside the allowlist", async () => {
    const cc = build();
    const r = await cc.run({ prompt: "hello", cwd: "C:/Windows", runId: "r1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/allowlist/i);
  });

  it("hard-blocks --dangerously-skip-permissions in the prompt", async () => {
    const cc = build();
    const r = await cc.run({
      prompt: "do X --dangerously-skip-permissions",
      cwd: root,
      runId: "r2",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/dangerously/i);
  });

  it("happy path: spawns and returns stdout", async () => {
    const cc = build();
    const r = await cc.run({ prompt: "say hi", cwd: root, runId: "r3" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.output).toContain("MOCK say hi");
  });

  it("registers the pid in the pidfile registry while running", async () => {
    const reg = new PidfileRegistry(pidDir);
    const cc = buildClaudeCode({
      pidfiles: reg,
      check: buildPathAllowlist({ roots: [`${root.replace(/\\/g, "/")}/**`] }),
      claudeBinary: process.execPath,
      claudeArgs: () => ["-e", "setTimeout(()=>{},50)"],
    });
    const p = cc.run({ prompt: "x", cwd: root, runId: "r4" });
    // not awaiting — give it a tick
    await new Promise((r) => setTimeout(r, 10));
    expect(reg.list("r4").length).toBeGreaterThan(0);
    await p;
    expect(reg.list("r4").length).toBe(0);
  });

  it("kills a never-closing child and resolves a timeout reason", async () => {
    const reg = new PidfileRegistry(pidDir);
    const cc = buildClaudeCode({
      pidfiles: reg,
      check: buildPathAllowlist({ roots: [`${root.replace(/\\/g, "/")}/**`] }),
      claudeBinary: process.execPath,
      // A child that never closes on its own (keeps the event loop alive). On
      // SIGTERM it chdir's out of the temp cwd and exits, so Windows releases
      // the directory handle and afterEach's rmSync can't EPERM-race the kill.
      claudeArgs: () => [
        "-e",
        "process.on('SIGTERM',()=>{try{process.chdir(require('os').tmpdir())}catch{};process.exit(0)});setInterval(()=>{},1000)",
      ],
    });
    const r = await cc.run({ prompt: "x", cwd: root, runId: "rT", timeoutMs: 80 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/timed out after 80ms/);
    // pid is released even on the timeout path so it doesn't leak/zombie.
    expect(reg.list("rT").length).toBe(0);
    // Let the SIGTERM'd child fully exit before afterEach removes the temp cwd.
    await new Promise((res) => setTimeout(res, 200));
  });

  it("scrubs secrets from output", async () => {
    const cc = buildClaudeCode({
      pidfiles: new PidfileRegistry(pidDir),
      check: buildPathAllowlist({ roots: [`${root.replace(/\\/g, "/")}/**`] }),
      claudeBinary: process.execPath,
      claudeArgs: () => [
        "-e",
        "console.log('Authorization: Bearer eyJabc.def.ghi')",
      ],
    });
    const r = await cc.run({ prompt: "x", cwd: root, runId: "r5" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.output).toContain("Bearer ***");
  });
});
