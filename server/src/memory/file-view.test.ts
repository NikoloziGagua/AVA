import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readMemoryView } from "./file-view.js";

function makeDir(): string {
  const d = mkdtempSync(join(tmpdir(), "ava-view-"));
  mkdirSync(join(d, "projects"));
  return d;
}

describe("readMemoryView", () => {
  let dir: string;
  beforeEach(() => { dir = makeDir(); });

  it("returns all known files plus a project list", () => {
    writeFileSync(join(dir, "personality.md"), "I am Ava.\n");
    writeFileSync(join(dir, "MEMORY.md"), "- index\n");
    writeFileSync(join(dir, "preferences.md"), "Sir prefers concise replies.\nOne per line.\n");
    writeFileSync(join(dir, "observations.md"),
      "- [2026-04-28 / low / preferences] uses pwsh\n" +
      "- [2026-04-29 / medium / people] Ali likes async standups\n");
    writeFileSync(join(dir, "projects", "yov.md"), "yov body\n");

    const v = readMemoryView(dir);
    expect(v.personality).toBe("I am Ava.\n");
    expect(v.personaProfile).toMatchObject({
      version: "2.0",
      architecture: "identity + collaboration + context registers",
      lab: { kind: "deterministic_contract", scenarioCount: 50, valid: true },
    });
    expect(v.personaProfile.registers.map((register) => register.id)).toEqual([
      "casual", "execution", "brainstorming", "repair", "high_stakes",
    ]);
    expect(v.memoryIndex).toBe("- index\n");
    expect(v.preferences.lines).toEqual([
      "Sir prefers concise replies.",
      "One per line.",
    ]);
    expect(v.observations.lines).toHaveLength(2);
    expect(v.observations.lines[0]).toMatchObject({
      raw: "- [2026-04-28 / low / preferences] uses pwsh",
      date: "2026-04-28",
      confidence: "low",
      category: "preferences",
      text: "uses pwsh",
    });
    expect(v.projects).toEqual([{ slug: "yov", body: "yov body\n" }]);
  });

  it("returns empty defaults on missing files", () => {
    const v = readMemoryView(dir);
    expect(v.personality).toBe("");
    expect(v.personaProfile.lab.scenarioCount).toBe(50);
    expect(v.preferences.lines).toEqual([]);
    expect(v.observations.lines).toEqual([]);
    expect(v.projects).toEqual([]);
  });

  it("skips unparseable observation lines", () => {
    writeFileSync(join(dir, "observations.md"),
      "garbage\n- [2026-04-28 / low / preferences] valid\n");
    const v = readMemoryView(dir);
    expect(v.observations.lines).toHaveLength(1);
  });
});
