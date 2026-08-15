import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { injectCodexConsoleHandoff, type RunConsoleInjector } from "./codex-console.js";

const temps: string[] = [];

afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ava-codex-console-"));
  temps.push(root);
  const watchId = "watch-console";
  const threadId = "thread-console";
  const pending = join(root, "pending", `${watchId}.json`);
  mkdirSync(join(root, "pending"), { recursive: true });
  writeFileSync(pending, JSON.stringify({
    schemaVersion: 1,
    watchId,
    threadId,
    cwd: "C:/repo/AVA",
    marker: `[AVA-WATCH:${watchId}]`,
    prompt: `[AVA-WATCH:${watchId}]\nBuild safely`,
  }));
  return { root, watchId, threadId, pending };
}

describe("standalone Codex TUI console handoff", () => {
  it("claims, injects, and writes a content-free idempotency receipt", () => {
    const f = fixture();
    let calls = 0;
    const run: RunConsoleInjector = ({ handoffPath }) => {
      calls += 1;
      expect(readFileSync(handoffPath, "utf8")).toContain("Build safely");
      return { status: "injected", detail: "queued", processId: 42 };
    };
    expect(injectCodexConsoleHandoff({ ...f, inboxDir: f.root, scriptPath: "inject.ps1", run })).toMatchObject({ status: "injected", processId: 42 });
    expect(injectCodexConsoleHandoff({ ...f, inboxDir: f.root, scriptPath: "inject.ps1", run })).toMatchObject({ status: "already_injected", processId: 42 });
    expect(calls).toBe(1);
    const receipt = readFileSync(join(f.root, "console-injected", `${f.watchId}.json`), "utf8");
    expect(receipt).not.toContain("Build safely");
    expect(receipt).toContain("promptSha256");
  });

  it("returns pre-write failures to pending for the Stop-hook fallback", () => {
    const f = fixture();
    const run: RunConsoleInjector = () => ({ status: "unavailable", detail: "no unique TUI" });
    expect(injectCodexConsoleHandoff({ ...f, inboxDir: f.root, scriptPath: "inject.ps1", run })).toEqual({ status: "unavailable", detail: "no unique TUI" });
    expect(readFileSync(f.pending, "utf8")).toContain("Build safely");
  });

  it("never replays an ambiguous partial input", () => {
    const f = fixture();
    let calls = 0;
    const run: RunConsoleInjector = () => {
      calls += 1;
      return { status: "ambiguous", detail: "partial write", processId: 42 };
    };
    expect(injectCodexConsoleHandoff({ ...f, inboxDir: f.root, scriptPath: "inject.ps1", run })).toMatchObject({ status: "ambiguous" });
    expect(injectCodexConsoleHandoff({ ...f, inboxDir: f.root, scriptPath: "inject.ps1", run })).toMatchObject({ status: "ambiguous" });
    expect(calls).toBe(1);
  });

  it("rejects a handoff for a different pinned thread", () => {
    const f = fixture();
    const run: RunConsoleInjector = () => ({ status: "injected", detail: "should not run", processId: 1 });
    expect(injectCodexConsoleHandoff({
      inboxDir: f.root,
      scriptPath: "inject.ps1",
      watchId: f.watchId,
      threadId: "another-thread",
      run,
    })).toMatchObject({ status: "unavailable" });
  });
});
