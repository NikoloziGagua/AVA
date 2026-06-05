import { describe, it, expect } from "vitest";
import { parseLogLine, selectLogEntries, formatLogEntries } from "./activity-log.js";

const line = (level: number, time: number, msg: string) => JSON.stringify({ level, time, msg });

const SAMPLE = [
  line(30, 1700000000000, 'realtime: do_on_computer task="open bing"'),
  line(50, 1700000001000, "self-improvement crashed: boom"),
  line(40, 1700000002000, "rule parse failed"),
  "not-json-garbage",
  line(30, 1700000003000, "screenshot saved to Downloads/Ava"),
];

describe("parseLogLine", () => {
  it("parses a pino JSON line into time/level/msg", () => {
    expect(parseLogLine(line(30, 123, "hi"))).toEqual({ time: 123, level: 30, msg: "hi" });
  });
  it("returns null for non-JSON or non-log lines", () => {
    expect(parseLogLine("garbage")).toBeNull();
    expect(parseLogLine("")).toBeNull();
    expect(parseLogLine(JSON.stringify({ foo: 1 }))).toBeNull();
  });
});

describe("selectLogEntries", () => {
  it("returns all parseable entries by default (skipping garbage)", () => {
    expect(selectLogEntries(SAMPLE)).toHaveLength(4);
  });
  it("level='errors' keeps only warnings + errors", () => {
    const e = selectLogEntries(SAMPLE, { level: "errors" });
    expect(e.map((x) => x.level)).toEqual([50, 40]);
  });
  it("filters by keyword (case-insensitive)", () => {
    const e = selectLogEntries(SAMPLE, { contains: "BING" });
    expect(e).toHaveLength(1);
    expect(e[0]!.msg).toContain("open bing");
  });
  it("returns the most recent `limit` entries", () => {
    const e = selectLogEntries(SAMPLE, { limit: 1 });
    expect(e).toHaveLength(1);
    expect(e[0]!.msg).toContain("screenshot saved");
  });
});

describe("formatLogEntries", () => {
  it("renders level + message lines", () => {
    const out = formatLogEntries(selectLogEntries(SAMPLE, { level: "errors" }));
    expect(out).toContain("error: self-improvement crashed: boom");
    expect(out).toContain("warn: rule parse failed");
    expect(out.split("\n")).toHaveLength(2);
  });
  it("has a friendly empty message", () => {
    expect(formatLogEntries([])).toMatch(/no matching activity/i);
  });
});
