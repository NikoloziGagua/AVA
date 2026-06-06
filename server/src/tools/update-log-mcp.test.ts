import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildUpdateLogTools } from "./update-log-mcp.js";
import { appendDevLog } from "../self/dev-log.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ava-ultools-")); });

const ctx = { runId: "r1" };

function tool(d: string) {
  return buildUpdateLogTools({ dataDir: d }).find((x) => x.tool.name === "read_claude_updates")!;
}

describe("read_claude_updates", () => {
  it("returns a friendly message when the log is empty", async () => {
    const r = await tool(dir).run({}, ctx);
    expect(r.ok).toBe(true);
    expect(r.text).toBe("No Claude update notes yet.");
  });

  it("lists recent entries newest last with phase, detail and commits", async () => {
    appendDevLog(dir, { phase: "shipped", title: "voice fix", detail: "stopped hallucinating", commits: ["abc1234"] });
    const r = await tool(dir).run({}, ctx);
    expect(r.ok).toBe(true);
    expect(r.text).toContain("Recent updates:");
    expect(r.text).toContain("[shipped] voice fix — stopped hallucinating (commits: abc1234)");
    expect(r.text).not.toContain("IN PROGRESS");
  });

  it("leads with IN PROGRESS when a started entry has no following shipped", async () => {
    appendDevLog(dir, { phase: "started", title: "wiring the update log", detail: "adding the tool" });
    const r = await tool(dir).run({}, ctx);
    expect(r.ok).toBe(true);
    expect(r.text.startsWith("IN PROGRESS — Claude is currently: wiring the update log")).toBe(true);
    expect(r.text).toContain("adding the tool");
    expect(r.text).toContain("Recent updates:");
  });

  it("honours the limit argument", async () => {
    for (let i = 0; i < 5; i++) appendDevLog(dir, { phase: "note", title: `n${i}` });
    const r = await tool(dir).run({ limit: 2 }, ctx);
    expect(r.text).toContain("[note] n3");
    expect(r.text).toContain("[note] n4");
    expect(r.text).not.toContain("[note] n2");
  });
});
