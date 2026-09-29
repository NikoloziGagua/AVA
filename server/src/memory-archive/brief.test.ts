import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openInMemoryDb } from "../state/db.js";
import { buildSystemPrompt } from "../orchestrator/system-prompt.js";
import { MemoryArchive } from "./archive.js";
import { BRIEF_FILE, renderBrief, writeBrief } from "./brief.js";
import type { MemoryRecord } from "./types.js";

const DAY = 86_400_000;
const NOW = Date.parse("2026-09-29T12:00:00Z");

function record(over: Partial<MemoryRecord>): MemoryRecord {
  return {
    id: "mem_x", kind: "fact", topic: "t", text: "A fact.", speechAct: "stated", status: "active", carry: true,
    sensitive: false, confidence: "high", origin: "conversation", sourceSessionId: null, sourceMessageIds: [1],
    saidAt: NOW - DAY, validFrom: NOW - DAY, validTo: null, dueAt: null, supersedesId: null, supersededById: null,
    version: 1, createdAt: NOW, updatedAt: NOW, ...over,
  };
}

describe("memory brief", () => {
  afterEach(() => { delete process.env.AVA_MEMORY_V2; });

  it("renders sections in a fixed order with who said it and when", () => {
    const text = renderBrief({
      now: NOW,
      current: [
        record({ id: "a", kind: "preference", text: "Open Instagram chats from the profile page.", saidAt: Date.parse("2026-08-11T19:00:00Z") }),
        record({ id: "b", kind: "fact", text: "Niko's mother is Teo.", speechAct: "requested", saidAt: Date.parse("2026-09-24T13:23:00Z") }),
        record({ id: "c", kind: "decision", text: "AVA recommended Stripe over Adyen.", speechAct: "discussed" }),
        record({ id: "d", kind: "commitment", text: "Agile assignment.", dueAt: NOW - DAY }),
        record({ id: "e", kind: "commitment", text: "Dentist.", dueAt: NOW + 2 * DAY }),
        record({ id: "f", kind: "event", text: "An old event.", saidAt: NOW - 40 * DAY }),
        record({ id: "g", kind: "fact", text: "Hidden.", carry: false }),
        record({ id: "h", kind: "fact", text: "Waiting.", status: "unconfirmed" }),
      ],
      ended: [record({ id: "i", kind: "project", text: "Calendar and Notes are the priorities.", status: "history", validTo: NOW - 2 * DAY })],
    });
    expect(text.indexOf("## About Niko")).toBeLessThan(text.indexOf("## Decisions he made"));
    expect(text.indexOf("## Decisions he made")).toBeLessThan(text.indexOf("## How he wants me to work"));
    expect(text).toContain("- Niko's mother is Teo. (he asked me to remember, 24 Sep)");
    expect(text).toContain("(we discussed; not his decision");
    expect(text).toContain("whether it happened is unknown");
    expect(text).toContain("Dentist. (he said, 28 Sep; due 1 Oct");
    expect(text).toContain("- Until 27 Sep: Calendar and Notes are the priorities. (no longer current)");
    for (const hidden of ["An old event.", "Hidden.", "Waiting."]) expect(text).not.toContain(hidden);
  });

  it("drops the least useful lines first and says how many are hidden", () => {
    const current = Array.from({ length: 80 }, (_, i) => record({
      id: `r${i}`, kind: i % 2 ? "event" : "fact", confidence: i % 3 ? "high" : "low",
      text: `Memory number ${i} with enough words to take some room in the brief.`,
    }));
    const text = renderBrief({ current, ended: [], now: NOW, maxChars: 2_000 });
    expect(text.length).toBeLessThanOrEqual(2_000);
    expect(text).toMatch(/\(\d+ more memories are stored but not shown here; search memory for them\.\)/);
    // Events go first, then low-confidence lines, then the oldest of what is left.
    expect(text).not.toContain("## Recent events");
    expect(text).not.toContain("Memory number 72 ");
    expect(text).toContain("Memory number 76 ");
    expect(text).not.toContain("Memory number 2 ");
    expect(renderBrief({ current, ended: [], now: NOW, maxChars: 2_000 })).toBe(text);
  });

  it("replaces the preferences and observations blocks only when memory v2 is on", () => {
    const dir = mkdtempSync(join(tmpdir(), "ava-brief-"));
    buildSystemPrompt({ memoryDir: dir, mode: "conversation", today: "2026-09-29" });
    writeFileSync(join(dir, "preferences.md"), "Old preference line.\n");
    writeFileSync(join(dir, "observations.md"), "- [2026-09-24 / medium / people] Old observation.\n");
    const archive = new MemoryArchive(openInMemoryDb(), () => NOW);
    archive.add({ kind: "fact", topic: "mother", text: "Niko's mother is Teo.", speechAct: "requested",
      confidence: "high", origin: "explicit", saidAt: NOW - DAY }, "niko");
    writeBrief(dir, archive, NOW);
    expect(readFileSync(join(dir, BRIEF_FILE), "utf8")).toContain("Niko's mother is Teo.");
    const off = buildSystemPrompt({ memoryDir: dir, mode: "conversation", today: "2026-09-29" });
    expect(off).toContain("Old preference line.");
    expect(off).not.toContain("Niko's mother is Teo.");
    process.env.AVA_MEMORY_V2 = "on";
    const on = buildSystemPrompt({ memoryDir: dir, mode: "conversation", today: "2026-09-29" });
    expect(on).toContain("# Memory: what I know about Niko");
    expect(on).toContain("Niko's mother is Teo.");
    expect(on).not.toContain("Old preference line.");
    expect(on).not.toContain("Old observation.");
  });
});
