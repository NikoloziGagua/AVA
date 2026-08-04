import { afterEach, describe, expect, it, vi } from "vitest";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  buildCodexDispatcher,
  inspectCodexThread,
  resolveLatestCodexTarget,
  type CodexWatchTarget,
} from "./codex-dispatch.js";

const temps: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "ava-codex-watch-"));
  temps.push(root);
  return root;
}

function event(type: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({ timestamp: new Date().toISOString(), type: "event_msg", payload: { type, ...extra } });
}

function makeSession(root: string, input: { id: string; cwd: string; state: "idle" | "busy"; mtimeHint?: number }): CodexWatchTarget {
  const sessionFile = join(root, "sessions", "2026", "08", "04", `rollout-${input.id}.jsonl`);
  mkdirSync(dirname(sessionFile), { recursive: true });
  const meta = JSON.stringify({
    timestamp: new Date().toISOString(),
    type: "session_meta",
    payload: { session_id: input.id, id: input.id, cwd: input.cwd, originator: "codex-tui" },
  });
  const lifecycle = input.state === "busy"
    ? [event("task_started", { turn_id: "turn-current" }), event("user_message", { message: "working" })]
    : [event("task_started", { turn_id: "turn-old" }), event("task_complete", { turn_id: "turn-old" })];
  writeFileSync(sessionFile, [meta, ...lifecycle, ""].join("\n"));
  if (input.mtimeHint) {
    const date = new Date(input.mtimeHint);
    utimesSync(sessionFile, date, date);
  }
  return { threadId: input.id, sessionFile, cwd: input.cwd };
}

describe("Codex watcher target resolution", () => {
  it("pins the newest Codex TUI session for the exact repository", () => {
    const root = tempRoot();
    makeSession(root, { id: "older", cwd: "C:/repo/AVA", state: "idle", mtimeHint: Date.now() - 10_000 });
    const latest = makeSession(root, { id: "latest", cwd: "C:/repo/AVA", state: "busy", mtimeHint: Date.now() });
    makeSession(root, { id: "other", cwd: "C:/repo/other", state: "idle", mtimeHint: Date.now() + 10_000 });

    expect(resolveLatestCodexTarget("C:/repo/AVA", root)).toEqual(latest);
  });
});

describe("Codex thread evidence", () => {
  it("separates busy, delivered, and completed boundaries", () => {
    const root = tempRoot();
    const target = makeSession(root, { id: "thread-1", cwd: "C:/repo/AVA", state: "idle" });
    const offset = inspectCodexThread(target).fileSize;
    appendFileSync(target.sessionFile, `${event("task_started", { turn_id: "turn-watch" })}\n`);
    appendFileSync(target.sessionFile, `${event("user_message", { message: "[AVA-WATCH:w1] build notes" })}\n`);

    const running = inspectCodexThread(target, "[AVA-WATCH:w1]", offset);
    expect(running).toMatchObject({ state: "busy", markerSeen: true, markerTurnCompleted: false, turnId: "turn-watch" });

    appendFileSync(target.sessionFile, `${event("task_complete", { turn_id: "turn-watch" })}\n`);
    expect(inspectCodexThread(target, "[AVA-WATCH:w1]", offset)).toMatchObject({
      state: "idle",
      markerSeen: true,
      markerTurnCompleted: true,
      turnId: "turn-watch",
    });
  });
});

describe("Codex watcher delivery", () => {
  it("does not dispatch while the pinned thread is busy", async () => {
    const root = tempRoot();
    const target = makeSession(root, { id: "thread-busy", cwd: "C:/repo/AVA", state: "busy" });
    const spawnCodex = vi.fn(() => ({ pid: 1 }));
    const dispatcher = buildCodexDispatcher({ repoRoot: target.cwd, logsDir: root, codexHome: root, spawnCodex, verifyMs: 20, pollMs: 1 });

    expect(await dispatcher.dispatch({ watchId: "w1", prompt: "build notes", target })).toMatchObject({ status: "busy" });
    expect(spawnCodex).not.toHaveBeenCalled();
  });

  it("verifies the prompt inside the exact thread and never dispatches it twice", async () => {
    const root = tempRoot();
    const target = makeSession(root, { id: "thread-idle", cwd: "C:/repo/AVA", state: "idle" });
    const spawnCodex = vi.fn((input: { prompt: string }) => {
      appendFileSync(target.sessionFile, `${event("task_started", { turn_id: "turn-delivered" })}\n`);
      appendFileSync(target.sessionFile, `${event("user_message", { message: input.prompt })}\n`);
      return { pid: 32148 };
    });
    const dispatcher = buildCodexDispatcher({ repoRoot: target.cwd, logsDir: root, codexHome: root, spawnCodex, verifyMs: 100, pollMs: 1 });

    const delivered = await dispatcher.dispatch({ watchId: "w2", prompt: "build notes", target });
    expect(delivered).toMatchObject({ status: "delivered", pid: 32148, turnId: "turn-delivered" });
    expect(spawnCodex).toHaveBeenCalledOnce();

    const second = await dispatcher.dispatch({
      watchId: "w2",
      prompt: "build notes",
      target,
      marker: "[AVA-WATCH:w2]",
      dispatchOffset: "dispatchOffset" in delivered ? delivered.dispatchOffset : 0,
    });
    expect(second).toMatchObject({ status: "already_delivered" });
    expect(spawnCodex).toHaveBeenCalledOnce();
  });

  it("never launches a duplicate while an earlier dispatch is pending", async () => {
    const root = tempRoot();
    const target = makeSession(root, { id: "thread-pending", cwd: "C:/repo/AVA", state: "idle" });
    const spawnCodex = vi.fn(() => ({ pid: 42 }));
    const dispatcher = buildCodexDispatcher({
      repoRoot: target.cwd,
      logsDir: root,
      codexHome: root,
      spawnCodex,
      isProcessRunning: () => true,
      verifyMs: 5,
      pollMs: 1,
    });

    const first = await dispatcher.dispatch({ watchId: "w3", prompt: "build notes", target });
    expect(first).toMatchObject({ status: "pending", pid: 42 });

    const second = await dispatcher.dispatch({
      watchId: "w3",
      prompt: "build notes",
      target,
      marker: "[AVA-WATCH:w3]",
      dispatchOffset: "dispatchOffset" in first ? first.dispatchOffset : 0,
      dispatchPid: 42,
    });
    expect(second).toMatchObject({ status: "pending" });
    expect(spawnCodex).toHaveBeenCalledOnce();
  });

  it("reports a lost delivery process without silently retrying", async () => {
    const root = tempRoot();
    const target = makeSession(root, { id: "thread-lost", cwd: "C:/repo/AVA", state: "idle" });
    const spawnCodex = vi.fn(() => ({ pid: 43 }));
    const dispatcher = buildCodexDispatcher({
      repoRoot: target.cwd,
      logsDir: root,
      codexHome: root,
      spawnCodex,
      isProcessRunning: () => false,
      verifyMs: 5,
      pollMs: 1,
    });
    const first = await dispatcher.dispatch({ watchId: "w4", prompt: "build notes", target });
    const second = await dispatcher.dispatch({
      watchId: "w4",
      prompt: "build notes",
      target,
      marker: "[AVA-WATCH:w4]",
      dispatchOffset: "dispatchOffset" in first ? first.dispatchOffset : 0,
      dispatchPid: 43,
    });
    expect(second).toMatchObject({ status: "error" });
    expect(spawnCodex).toHaveBeenCalledOnce();
  });
});
