import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PidfileRegistry } from "./pidfile.js";

describe("PidfileRegistry", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ava-pidfiles-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("registers a pid for a run and lists it", () => {
    const reg = new PidfileRegistry(dir);
    reg.add("run-1", 12345);
    expect(reg.list("run-1")).toEqual([12345]);
  });

  it("creates a file per pid under data/pidfiles/<runId>/<pid>", () => {
    const reg = new PidfileRegistry(dir);
    reg.add("run-2", 999);
    expect(existsSync(join(dir, "run-2", "999"))).toBe(true);
  });

  it("lists all pids for a run with multiple children", () => {
    const reg = new PidfileRegistry(dir);
    reg.add("run-3", 100);
    reg.add("run-3", 200);
    expect(reg.list("run-3").sort()).toEqual([100, 200]);
  });

  it("clears all pidfiles for a run", () => {
    const reg = new PidfileRegistry(dir);
    reg.add("run-4", 1);
    reg.add("run-4", 2);
    reg.clear("run-4");
    expect(reg.list("run-4")).toEqual([]);
    expect(existsSync(join(dir, "run-4"))).toBe(false);
  });

  it("listAll() finds pids across all runs (for boot recovery)", () => {
    const reg = new PidfileRegistry(dir);
    reg.add("run-A", 11);
    reg.add("run-B", 22);
    expect(reg.listAll().sort((a, b) => a.pid - b.pid)).toEqual([
      { runId: "run-A", pid: 11 },
      { runId: "run-B", pid: 22 },
    ]);
  });

  it("ignores non-numeric files in run directories", () => {
    const reg = new PidfileRegistry(dir);
    reg.add("run-5", 7);
    // simulate a stray file
    writeFileSync(join(dir, "run-5", "garbage.txt"), "x");
    expect(reg.list("run-5")).toEqual([7]);
  });

  it("remove deletes a single pid without touching siblings", () => {
    const reg = new PidfileRegistry(dir);
    reg.add("run-x", 100);
    reg.add("run-x", 200);
    reg.remove("run-x", 100);
    expect(reg.list("run-x")).toEqual([200]);
  });

  it("remove on the last pid leaves the run dir empty (but does not delete it)", () => {
    const reg = new PidfileRegistry(dir);
    reg.add("run-y", 7);
    reg.remove("run-y", 7);
    expect(reg.list("run-y")).toEqual([]);
  });

  it("remove on an unknown pid is a no-op", () => {
    const reg = new PidfileRegistry(dir);
    reg.add("run-z", 1);
    expect(() => reg.remove("run-z", 999)).not.toThrow();
    expect(reg.list("run-z")).toEqual([1]);
  });
});
