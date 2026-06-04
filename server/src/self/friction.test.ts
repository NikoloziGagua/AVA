import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordMistake, listOpenMistakes, resolveMistake, mistakeToGoal, type Surface } from "./friction.js";

function dir() { return mkdtempSync(join(tmpdir(), "ava-fric-")); }
const m = (over: Partial<{ surface: Surface; summary: string; detail: string; severity: number; today: string }> = {}) => ({
  surface: "voice" as Surface, summary: "voice hallucinates on silence",
  detail: "owner was silent, Ava transcribed 'thank you'", severity: 1, today: "2026-06-04", ...over,
});

describe("friction ledger", () => {
  let d: string;
  beforeEach(() => { d = dir(); });

  it("records a new mistake as open with count 1", () => {
    const r = recordMistake(d, m());
    expect(r.status).toBe("open");
    expect(r.count).toBe(1);
    expect(listOpenMistakes(d).length).toBe(1);
  });

  it("dedups a recurring mistake: bumps count + last_seen, keeps freshest detail", () => {
    recordMistake(d, m({ today: "2026-06-01" }));
    const r = recordMistake(d, m({ today: "2026-06-04", detail: "happened again, said 'thanks for watching'" }));
    expect(r.count).toBe(2);
    expect(r.last_seen).toBe("2026-06-04");
    expect(r.detail).toContain("thanks for watching");
    expect(listOpenMistakes(d).length).toBe(1); // not duplicated
  });

  it("REOPENS a resolved mistake if it recurs (reality beats green tests)", () => {
    const first = recordMistake(d, m());
    resolveMistake(d, first.id, "abc123");
    expect(listOpenMistakes(d).length).toBe(0);
    const again = recordMistake(d, m({ today: "2026-06-05" }));
    expect(again.status).toBe("open");
    expect(again.reopened).toBe(true);
    expect(again.count).toBe(2);
    expect(listOpenMistakes(d).length).toBe(1);
  });

  it("prioritizes by severity, then count, then recency", () => {
    recordMistake(d, m({ summary: "low-sev once", severity: 1, today: "2026-06-04" }));
    recordMistake(d, m({ summary: "high-sev", severity: 3, today: "2026-06-01" }));
    recordMistake(d, m({ summary: "mid recurring", severity: 1 }));
    recordMistake(d, m({ summary: "mid recurring" })); // count 2
    const order = listOpenMistakes(d).map((x) => x.summary);
    expect(order[0]).toBe("high-sev");      // severity wins
    expect(order[1]).toBe("mid recurring"); // then count
  });

  it("resolveMistake marks it resolved with the fixing commit", () => {
    const r = recordMistake(d, m());
    resolveMistake(d, r.id, "deadbeef");
    expect(listOpenMistakes(d).length).toBe(0);
  });

  it("mistakeToGoal carries the evidence and flags recurrence only when reopened", () => {
    const fresh = recordMistake(d, m());
    const g1 = mistakeToGoal(fresh);
    expect(g1).toContain("voice hallucinates on silence");
    expect(g1).toContain("transcribed 'thank you'");
    expect(g1).not.toContain("RECURRED");

    resolveMistake(d, fresh.id, "c1");
    const reopened = recordMistake(d, m({ today: "2026-06-06" }));
    expect(mistakeToGoal(reopened)).toContain("RECURRED");
  });
});
