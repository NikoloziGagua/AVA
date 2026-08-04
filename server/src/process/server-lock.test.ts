import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireServerLock } from "./server-lock.js";

const roots: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

function lockPath(): string {
  const root = mkdtempSync(join(tmpdir(), "ava-server-lock-"));
  roots.push(root);
  return join(root, "ava-server.lock");
}

describe("AVA server singleton lock", () => {
  it("rejects a second live owner before shared boot state can change", () => {
    const path = lockPath();
    const first = acquireServerLock(path, { pid: 101, isPidAlive: () => true });
    expect(() => acquireServerLock(path, { pid: 202, isPidAlive: () => true }))
      .toThrow("already running as PID 101");
    first.release();
    expect(existsSync(path)).toBe(false);
  });

  it("replaces a dead owner's stale lock and protects the replacement", () => {
    const path = lockPath();
    const stale = acquireServerLock(path, { pid: 101, isPidAlive: () => true });
    const current = acquireServerLock(path, { pid: 202, isPidAlive: () => false });

    stale.release();
    expect(existsSync(path)).toBe(true);
    current.release();
    expect(existsSync(path)).toBe(false);
  });
});
