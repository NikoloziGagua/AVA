import { describe, it, expect } from "vitest";
import { promoteOnRepeat, normalizeForCompare } from "./promote.js";

describe("memory/promote normalizeForCompare", () => {
  it("lowercases, strips punctuation, collapses whitespace", () => {
    expect(normalizeForCompare("Uses  PWSH, for shell."))
      .toBe("uses pwsh for shell");
  });
});

describe("memory/promote promoteOnRepeat", () => {
  it("appends when no prior line in same category matches", () => {
    const file = "- [2026-04-20 / low / preferences] uses pwsh\n";
    const newLine = "- [2026-04-29 / low / preferences] likes terse replies";
    const r = promoteOnRepeat(file, newLine, "2026-04-29");
    expect(r.kind).toBe("appended");
    expect(r.content).toContain("uses pwsh");
    expect(r.content).toContain("likes terse replies");
  });

  it("bumps low to medium on repeat in same category", () => {
    const file = "- [2026-04-20 / low / preferences] uses pwsh for shell\n";
    const newLine = "- [2026-04-29 / low / preferences] uses pwsh for shell";
    const r = promoteOnRepeat(file, newLine, "2026-04-29");
    expect(r.kind).toBe("promoted");
    expect(r.content).toBe(
      "- [2026-04-29 / medium / preferences] uses pwsh for shell\n",
    );
  });

  it("bumps medium to high; high stays at high (capped)", () => {
    const file =
      "- [2026-04-20 / medium / preferences] uses pwsh for shell\n";
    const newLine = "- [2026-04-29 / low / preferences] uses pwsh for shell";
    const once = promoteOnRepeat(file, newLine, "2026-04-29");
    expect(once.content).toContain("/ high /");
    const twice = promoteOnRepeat(once.content, newLine, "2026-04-30");
    expect(twice.kind).toBe("promoted");
    expect(twice.content).toContain("[2026-04-30 / high / preferences]");
  });

  it("treats whitespace and punctuation as equivalent", () => {
    const file = "- [2026-04-20 / low / preferences] Uses PWSH, for shell.\n";
    const newLine = "- [2026-04-29 / low / preferences] uses  pwsh for shell";
    const r = promoteOnRepeat(file, newLine, "2026-04-29");
    expect(r.kind).toBe("promoted");
  });

  it("does not match across categories", () => {
    const file = "- [2026-04-20 / low / context] uses pwsh\n";
    const newLine = "- [2026-04-29 / low / preferences] uses pwsh";
    const r = promoteOnRepeat(file, newLine, "2026-04-29");
    expect(r.kind).toBe("appended");
    expect(r.content.split("\n").filter((l) => l.includes("uses pwsh")))
      .toHaveLength(2);
  });

  it("ignores superseded lines for matching", () => {
    const file =
      "- [2026-01-12 / high / preferences / superseded 2026-04-20] uses pwsh\n";
    const newLine = "- [2026-04-29 / low / preferences] uses pwsh";
    const r = promoteOnRepeat(file, newLine, "2026-04-29");
    expect(r.kind).toBe("appended");
  });
});
