import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildClaudeCode } from "./claude-code.js";
import { PidfileRegistry } from "../process/pidfile.js";
import { buildPathAllowlist } from "../security/path-allowlist.js";

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
