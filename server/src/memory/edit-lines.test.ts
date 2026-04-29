import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { editLine, deleteLine, appendLineTo } from "./edit-lines.js";
import { memoryPaths } from "./paths.js";

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), "ava-edit-"));
}

describe("editLine", () => {
  let dir: string;
  beforeEach(() => { dir = makeDir(); });

  it("replaces an exact match in preferences and writes back", () => {
    writeFileSync(memoryPaths(dir).preferences, "alpha\nbeta\n");
    const r = editLine({
      memoryDir: dir, file: "preferences",
      oldLine: "beta", newLine: "BETA-2",
    });
    expect(r.kind).toBe("ok");
    expect(readFileSync(memoryPaths(dir).preferences, "utf8"))
      .toBe("alpha\nBETA-2\n");
  });

  it("returns stale when oldLine is not present", () => {
    writeFileSync(memoryPaths(dir).preferences, "alpha\n");
    const r = editLine({
      memoryDir: dir, file: "preferences",
      oldLine: "missing", newLine: "x",
    });
    expect(r.kind).toBe("stale");
    if (r.kind === "stale") expect(r.current).toBe("alpha\n");
  });

  it("works on observations.md", () => {
    writeFileSync(memoryPaths(dir).observations,
      "- [2026-04-28 / low / preferences] foo\n");
    const r = editLine({
      memoryDir: dir, file: "observations",
      oldLine: "- [2026-04-28 / low / preferences] foo",
      newLine: "- [2026-04-28 / medium / preferences] foo",
    });
    expect(r.kind).toBe("ok");
  });
});

describe("deleteLine", () => {
  let dir: string;
  beforeEach(() => { dir = makeDir(); });

  it("removes a line and collapses surrounding blank space", () => {
    writeFileSync(memoryPaths(dir).preferences, "alpha\nbeta\ngamma\n");
    const r = deleteLine({ memoryDir: dir, file: "preferences", oldLine: "beta" });
    expect(r.kind).toBe("ok");
    expect(readFileSync(memoryPaths(dir).preferences, "utf8"))
      .toBe("alpha\ngamma\n");
  });

  it("returns stale when nothing matches", () => {
    writeFileSync(memoryPaths(dir).preferences, "alpha\n");
    const r = deleteLine({ memoryDir: dir, file: "preferences", oldLine: "zzz" });
    expect(r.kind).toBe("stale");
  });
});

describe("appendLineTo", () => {
  let dir: string;
  beforeEach(() => { dir = makeDir(); });

  it("appends to preferences and runs the firewall", () => {
    appendLineTo({
      memoryDir: dir, file: "preferences",
      line: "API key sk-ant-1234567890abcdefghijklmnopqrstuvwx",
    });
    const out = readFileSync(memoryPaths(dir).preferences, "utf8");
    expect(out).not.toContain("1234567890abcdefghijklmnopqrstuvwx");
  });
});
