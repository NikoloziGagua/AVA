import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writePlaybook, readPlaybook, listPlaybooks, type Playbook } from "./store.js";
import { bumpUse, prunePlaybooks } from "./mutate.js";

function dir() { return mkdtempSync(join(tmpdir(), "ava-pbm-")); }
const pb = (slug: string, over: Partial<Playbook> = {}): Playbook => ({
  slug, trigger: slug, keywords: [], created: "2026-01-01", last_used: "2026-01-01",
  uses: 1, stakes: "routine", steps: ["a", "b"],
  version: 1, succ: 0, fail: 0, avg_secs: 0, lessons: [], ...over,
});

describe("bumpUse", () => {
  it("increments uses and updates last_used", () => {
    const d = dir(); writePlaybook(d, pb("x", { uses: 2 }));
    bumpUse(d, "x", "2026-06-02");
    const r = readPlaybook(d, "x")!;
    expect(r.uses).toBe(3);
    expect(r.last_used).toBe("2026-06-02");
  });
  it("is a no-op for an unknown slug", () => {
    const d = dir(); expect(() => bumpUse(d, "nope", "2026-06-02")).not.toThrow();
  });
});

describe("prunePlaybooks", () => {
  it("drops stale one-off playbooks past the age cutoff", () => {
    const d = dir();
    writePlaybook(d, pb("old-oneoff", { uses: 1, last_used: "2026-01-01" }));
    writePlaybook(d, pb("kept-used", { uses: 9, last_used: "2026-01-01" }));
    prunePlaybooks(d, { today: "2026-06-02", maxAgeDays: 30, softCap: 50 });
    expect(listPlaybooks(d).map((p) => p.slug).sort()).toEqual(["kept-used"]);
  });
  it("caps total count, keeping the most-used", () => {
    const d = dir();
    for (let i = 0; i < 5; i++) writePlaybook(d, pb(`p${i}`, { uses: i, last_used: "2026-06-02" }));
    prunePlaybooks(d, { today: "2026-06-02", maxAgeDays: 365, softCap: 3 });
    const kept = listPlaybooks(d).map((p) => p.slug).sort();
    expect(kept).toEqual(["p2", "p3", "p4"]); // lowest-use dropped
  });
});
