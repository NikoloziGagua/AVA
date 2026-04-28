import { describe, it, expect } from "vitest";
import {
  parseObservation,
  serializeObservation,
  bumpConfidence,
  applyRefresh,
  applySupersede,
  type Observation,
} from "./observations.js";

describe("memory/observations parse + serialize", () => {
  it("parses a typical line", () => {
    const line = "- [2026-04-28 / high / preferences] uses pwsh for shell";
    const o = parseObservation(line);
    expect(o).toEqual({
      date: "2026-04-28",
      confidence: "high",
      category: "preferences",
      text: "uses pwsh for shell",
      superseded: null,
    } satisfies Observation);
  });

  it("parses a superseded line", () => {
    const line = "- [2026-01-12 / high / preferences / superseded 2026-04-28] uses pwsh";
    const o = parseObservation(line);
    expect(o?.superseded).toBe("2026-04-28");
  });

  it("returns null for a non-observation line", () => {
    expect(parseObservation("# heading")).toBeNull();
    expect(parseObservation("")).toBeNull();
  });

  it("round-trips serialize(parse(line))", () => {
    const line = "- [2026-04-28 / medium / context] main project is Ava";
    expect(serializeObservation(parseObservation(line)!)).toBe(line);
  });
});

describe("memory/observations confidence transitions", () => {
  it("bumps low → medium → high; high stays high", () => {
    expect(bumpConfidence("low")).toBe("medium");
    expect(bumpConfidence("medium")).toBe("high");
    expect(bumpConfidence("high")).toBe("high");
  });
});

describe("memory/observations applyRefresh", () => {
  it("finds the matching line by substring, bumps tier and updates date", () => {
    const file =
      "- [2026-04-20 / low / preferences] uses pwsh for shell\n" +
      "- [2026-04-21 / medium / context] main project is Ava\n";
    const out = applyRefresh(file, { match: "pwsh", today: "2026-04-28" });
    expect(out.changed).toBe(true);
    expect(out.content).toBe(
      "- [2026-04-28 / medium / preferences] uses pwsh for shell\n" +
      "- [2026-04-21 / medium / context] main project is Ava\n"
    );
  });

  it("returns changed=false when no match", () => {
    const file = "- [2026-04-20 / low / preferences] uses pwsh\n";
    const out = applyRefresh(file, { match: "vscode", today: "2026-04-28" });
    expect(out.changed).toBe(false);
    expect(out.content).toBe(file);
  });
});

describe("memory/observations applySupersede", () => {
  it("appends a 'superseded YYYY-MM-DD' marker to a matching active line", () => {
    const file = "- [2026-01-12 / high / preferences] uses pwsh for shell\n";
    const out = applySupersede(file, { match: "pwsh", today: "2026-04-28" });
    expect(out.changed).toBe(true);
    expect(out.content).toBe(
      "- [2026-01-12 / high / preferences / superseded 2026-04-28] uses pwsh for shell\n"
    );
  });

  it("does not double-mark an already-superseded line", () => {
    const file = "- [2026-01-12 / high / preferences / superseded 2026-04-01] uses pwsh\n";
    const out = applySupersede(file, { match: "pwsh", today: "2026-04-28" });
    expect(out.changed).toBe(false);
  });
});
