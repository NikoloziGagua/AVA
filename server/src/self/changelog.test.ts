import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendChangelog, readChangelog } from "./changelog.js";

function dir() { return mkdtempSync(join(tmpdir(), "ava-cl-")); }

describe("self changelog", () => {
  let d: string;
  beforeEach(() => { d = dir(); });

  it("appends dated lines and reads them back", () => {
    appendChangelog(d, { summary: "fixed voice hallucination", commit: "abcdef1234", date: "2026-06-04" });
    appendChangelog(d, { summary: "voice can now take actions", commit: "1234567890", date: "2026-06-05" });
    const out = readChangelog(d);
    expect(out).toContain("fixed voice hallucination");
    expect(out).toContain("voice can now take actions");
    expect(out).toContain("2026-06-04 (abcdef12)");
  });

  it("readChangelog returns only the most recent N lines", () => {
    for (let i = 0; i < 40; i++) appendChangelog(d, { summary: `change ${i}`, date: "2026-06-04" });
    const lines = readChangelog(d, 5).split("\n");
    expect(lines.length).toBe(5);
    expect(lines.at(-1)).toContain("change 39");
  });
});
