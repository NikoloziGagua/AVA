import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureProfileDir } from "./chrome.js";

describe("ensureProfileDir", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ava-chrome-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("creates the dir if missing", () => {
    const sub = join(dir, "missing");
    ensureProfileDir(sub);
    expect(existsSync(sub)).toBe(true);
  });

  it("removes a stale SingletonLock", () => {
    const lock = join(dir, "SingletonLock");
    writeFileSync(lock, "stale");
    ensureProfileDir(dir);
    expect(existsSync(lock)).toBe(false);
  });
});
