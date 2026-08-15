import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  readCodexHandoffCompletion,
  stageCodexHandoff,
} from "./codex-handoff.js";

const hookScript = fileURLToPath(new URL("../../../scripts/codex-watch-stop-hook.mjs", import.meta.url));

function root(): string {
  return mkdtempSync(join(tmpdir(), "ava-codex-handoff-"));
}

function stage(inboxDir: string, watchId: string, parentWatchId: string | null = null, continueCycle = false) {
  return stageCodexHandoff(inboxDir, {
    watchId,
    parentWatchId,
    threadId: "thread-1",
    cwd: "C:/repo/AVA",
    marker: `[AVA-WATCH:${watchId}]`,
    dispatchOffset: 10,
    continueCycle,
    prompt: `[AVA-WATCH:${watchId}]\nBuild the bounded task.`,
  });
}

function runHook(inboxDir: string, input: object, waitMs = 0): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [hookScript, inboxDir], {
      env: { ...process.env, AVA_CODEX_WATCH_WAIT_MS: String(waitMs) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => resolveRun({ stdout, stderr, code }));
    child.stdin.end(JSON.stringify(input));
  });
}

function stopInput(stopHookActive: boolean) {
  return {
    session_id: "thread-1",
    turn_id: "turn-1",
    cwd: "C:/repo/AVA",
    hook_event_name: "Stop",
    stop_hook_active: stopHookActive,
  };
}

async function waitUntil(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  throw new Error("condition timed out");
}

describe("Codex in-thread Stop-hook handoff", () => {
  it("stages idempotently and redacts secrets before the async boundary", () => {
    const inbox = root();
    const first = stageCodexHandoff(inbox, {
      watchId: "watch-1",
      parentWatchId: null,
      threadId: "thread-1",
      cwd: "C:/repo/AVA",
      marker: "[AVA-WATCH:watch-1]",
      dispatchOffset: 2,
      continueCycle: false,
      prompt: "Use token=sk-proj-abcdefghijklmnopqrstuvwxyz123456 safely",
    });
    const second = stageCodexHandoff(inbox, {
      watchId: "watch-1",
      parentWatchId: null,
      threadId: "thread-1",
      cwd: "C:/repo/AVA",
      marker: "[AVA-WATCH:watch-1]",
      dispatchOffset: 2,
      continueCycle: false,
      prompt: "different replay text must not replace the staged instruction",
    });

    expect(first.existing).toBe(false);
    expect(second.existing).toBe(true);
    const persisted = readFileSync(join(inbox, "pending", "watch-1.json"), "utf8");
    expect(persisted).toContain("sk-***");
    expect(persisted).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
    expect(persisted).not.toContain("different replay text");
  });

  it("claims one matching instruction inside the existing Codex writer", async () => {
    const inbox = root();
    stage(inbox, "watch-1");

    const first = await runHook(inbox, stopInput(false));
    expect(first).toMatchObject({ code: 0, stderr: "" });
    expect(JSON.parse(first.stdout)).toEqual({
      decision: "block",
      reason: "[AVA-WATCH:watch-1]\nBuild the bounded task.",
    });
    expect(existsSync(join(inbox, "claimed", "watch-1.json"))).toBe(true);

    const replay = await runHook(inbox, stopInput(false));
    expect(replay.stdout).toBe("");
  });

  it("records a clean boundary and hands the planned successor into the same turn", async () => {
    const inbox = root();
    stage(inbox, "parent", null, true);
    await runHook(inbox, stopInput(false));

    const completionRun = runHook(inbox, stopInput(true), 2_000);
    await waitUntil(() => Boolean(readCodexHandoffCompletion(inbox, "parent")));
    stage(inbox, "child", "parent", true);
    const result = await completionRun;

    expect(readCodexHandoffCompletion(inbox, "parent")).toMatchObject({
      watchId: "parent",
      threadId: "thread-1",
      turnId: "turn-1",
    });
    expect(JSON.parse(result.stdout)).toEqual({
      decision: "block",
      reason: "[AVA-WATCH:child]\nBuild the bounded task.",
    });
    expect(existsSync(join(inbox, "claimed", "child.json"))).toBe(true);
  });

  it("ignores a handoff for another thread or repository", async () => {
    const inbox = root();
    stage(inbox, "watch-1");
    const result = await runHook(inbox, { ...stopInput(false), session_id: "thread-2" });
    expect(result.stdout).toBe("");
    expect(existsSync(join(inbox, "pending", "watch-1.json"))).toBe(true);
  });
});
