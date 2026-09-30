import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireServerLock } from "./server-lock.js";

const roots: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

// A live AVA owner in the current boot, unless a test says otherwise.
const AVA_OWNER = { isPidAlive: () => true, isPidNode: () => true, bootTime: 0 };

function lockPath(): string {
  const root = mkdtempSync(join(tmpdir(), "ava-server-lock-"));
  roots.push(root);
  return join(root, "ava-server.lock");
}

describe("AVA server singleton lock", () => {
  it("rejects a second live owner before shared boot state can change", () => {
    const path = lockPath();
    const first = acquireServerLock(path, { pid: 101, ...AVA_OWNER });
    expect(() => acquireServerLock(path, { pid: 202, ...AVA_OWNER }))
      .toThrow("already running as PID 101");
    first.release();
    expect(existsSync(path)).toBe(false);
  });

  it("replaces a dead owner's stale lock and protects the replacement", () => {
    const path = lockPath();
    const stale = acquireServerLock(path, { pid: 101, ...AVA_OWNER });
    const current = acquireServerLock(path, { pid: 202, ...AVA_OWNER, isPidAlive: () => false });

    stale.release();
    expect(existsSync(path)).toBe(true);
    current.release();
    expect(existsSync(path)).toBe(false);
  });

  it("treats a lock from before the last reboot as stale, whatever now holds its PID", () => {
    const path = lockPath();
    const bootTime = Date.parse("2026-09-24T08:40:00Z");
    // Written yesterday; after the reboot Windows gave PID 5148 to svchost.
    acquireServerLock(path, { pid: 5148, now: bootTime - 86_400_000, ...AVA_OWNER });
    const next = acquireServerLock(path, { pid: 777, now: bootTime + 60_000, ...AVA_OWNER, bootTime });
    expect(next.pid).toBe(777);
    next.release();
  });

  it("treats a live PID that is not Node as stale within the same boot", () => {
    const path = lockPath();
    acquireServerLock(path, { pid: 5148, ...AVA_OWNER });
    const next = acquireServerLock(path, { pid: 777, ...AVA_OWNER, isPidNode: () => false });
    expect(next.pid).toBe(777);
    next.release();
  });

  it("stays conservative when the owner's process type cannot be determined", () => {
    const path = lockPath();
    acquireServerLock(path, { pid: 5148, ...AVA_OWNER });
    expect(() => acquireServerLock(path, { pid: 777, ...AVA_OWNER, isPidNode: () => null }))
      .toThrow("already running as PID 5148");
  });

  it("tolerates small clock differences around the boot time", () => {
    const path = lockPath();
    const bootTime = Date.parse("2026-09-24T08:40:00Z");
    // Written 30 s "before" boot by clock rounding: still this boot's AVA.
    acquireServerLock(path, { pid: 4242, now: bootTime - 30_000, ...AVA_OWNER });
    expect(() => acquireServerLock(path, { pid: 777, ...AVA_OWNER, bootTime }))
      .toThrow("already running as PID 4242");
  });
});
