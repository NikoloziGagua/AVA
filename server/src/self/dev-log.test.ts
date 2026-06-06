import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendDevLog, readDevLog, currentInProgress } from "./dev-log.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ava-devlog-")); });

describe("self/dev-log", () => {
  it("appends a stamped JSON line and reads it back (round-trip)", () => {
    const entry = appendDevLog(dir, { phase: "note", title: "hello", detail: "world" });
    expect(typeof entry.ts).toBe("string");
    expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(existsSync(join(dir, "claude-updates.jsonl"))).toBe(true);
    const out = readDevLog(dir);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual(entry);
    expect(out[0]!.title).toBe("hello");
    expect(out[0]!.detail).toBe("world");
  });

  it("readDevLog returns the last `limit` entries oldest→newest", () => {
    for (let i = 0; i < 15; i++) appendDevLog(dir, { phase: "note", title: `n${i}` });
    const out = readDevLog(dir, 5);
    expect(out).toHaveLength(5);
    expect(out.map((e) => e.title)).toEqual(["n10", "n11", "n12", "n13", "n14"]);
  });

  it("readDevLog tolerates malformed/blank lines (skips them)", () => {
    appendDevLog(dir, { phase: "note", title: "good1" });
    // Inject garbage + blank lines directly into the file.
    const f = join(dir, "claude-updates.jsonl");
    const existing = readFileSync(f, "utf8");
    writeFileSync(f, existing + "not json\n\n   \n{bad}\n", "utf8");
    appendDevLog(dir, { phase: "note", title: "good2" });
    const out = readDevLog(dir);
    expect(out.map((e) => e.title)).toEqual(["good1", "good2"]);
  });

  it("readDevLog returns [] when the file does not exist", () => {
    expect(readDevLog(dir)).toEqual([]);
  });

  it("currentInProgress is the started entry after a lone 'started'", () => {
    appendDevLog(dir, { phase: "started", title: "wiring the tool" });
    const ip = currentInProgress(dir);
    expect(ip).not.toBeNull();
    expect(ip!.title).toBe("wiring the tool");
  });

  it("currentInProgress is null after a following 'shipped'", () => {
    appendDevLog(dir, { phase: "started", title: "wiring the tool" });
    appendDevLog(dir, { phase: "shipped", title: "tool shipped" });
    expect(currentInProgress(dir)).toBeNull();
  });

  it("currentInProgress ignores 'note' entries and tracks the latest started", () => {
    appendDevLog(dir, { phase: "started", title: "first" });
    appendDevLog(dir, { phase: "shipped", title: "first done" });
    appendDevLog(dir, { phase: "note", title: "just a note" });
    appendDevLog(dir, { phase: "started", title: "second" });
    appendDevLog(dir, { phase: "note", title: "another note" });
    const ip = currentInProgress(dir);
    expect(ip).not.toBeNull();
    expect(ip!.title).toBe("second");
  });

  it("currentInProgress returns null when the file does not exist", () => {
    expect(currentInProgress(dir)).toBeNull();
  });
});
