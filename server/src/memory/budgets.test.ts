import { describe, it, expect } from "vitest";
import { estimateTokens, autoPruneObservations, SOFT_CAPS, HARD_CAPS } from "./budgets.js";

describe("estimateTokens", () => {
  it("approximates as ceil(chars/4)", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});

describe("autoPruneObservations", () => {
  it("does nothing under the soft cap", () => {
    const c = "- [2026-04-28 / high / preferences] uses pwsh\n";
    const out = autoPruneObservations(c, { today: "2026-04-28", softCap: 1000 });
    expect(out.content).toBe(c);
    expect(out.action).toBe("none");
  });

  it("drops superseded lines first when over soft cap", () => {
    const c =
      "- [2026-01-12 / high / preferences / superseded 2026-04-28] old pwsh\n" +
      "- [2026-04-28 / high / preferences] uses pwsh\n";
    const out = autoPruneObservations(c, { today: "2026-04-28", softCap: 5 });
    expect(out.content).toBe("- [2026-04-28 / high / preferences] uses pwsh\n");
    expect(out.action).toBe("dropped_superseded");
  });

  it("then drops low-confidence stale (>60d) lines", () => {
    const c =
      "- [2026-01-01 / low / context] stale low entry\n" +
      "- [2026-04-28 / high / preferences] fresh\n";
    const out = autoPruneObservations(c, { today: "2026-04-28", softCap: 5 });
    expect(out.content).toBe("- [2026-04-28 / high / preferences] fresh\n");
    expect(out.action).toBe("dropped_stale_low");
  });

  it("returns only dropped_superseded when both superseded and stale-low lines exist (one tier per turn)", () => {
    const c =
      "- [2026-01-12 / high / preferences / superseded 2026-04-28] old pwsh\n" +
      "- [2026-01-01 / low / context] stale low entry\n" +
      "- [2026-04-28 / high / preferences] fresh\n";
    const out = autoPruneObservations(c, { today: "2026-04-28", softCap: 5 });
    expect(out.action).toBe("dropped_superseded");
    expect(out.content).toBe(
      "- [2026-01-01 / low / context] stale low entry\n" +
      "- [2026-04-28 / high / preferences] fresh\n");
  });

  it("returns action=needs_user when still over after both passes", () => {
    const huge = Array.from({ length: 50 }, (_, i) =>
      `- [2026-04-28 / high / preferences] entry ${i} that is moderately long`).join("\n") + "\n";
    const out = autoPruneObservations(huge, { today: "2026-04-28", softCap: 5 });
    expect(out.action).toBe("needs_user");
  });
});

describe("caps table", () => {
  it("matches §4.8", () => {
    expect(SOFT_CAPS.observations).toBe(2000);
    expect(HARD_CAPS.observations).toBe(4000);
    expect(SOFT_CAPS.preferences).toBe(1000);
    expect(HARD_CAPS.preferences).toBe(2000);
  });
});
