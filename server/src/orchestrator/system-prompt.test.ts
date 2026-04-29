import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSystemPrompt } from "./system-prompt.js";
import { TOOL_RUBRIC } from "./tool-rubric.js";
import { PERSONALITY_MD } from "../memory/personality-content.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ava-sp-")); });

describe("buildSystemPrompt (layered)", () => {
  it("assembles persona → memoryIndex → preferences → observations → rubric, in that order", () => {
    writeFileSync(join(dir, "personality.md"), "PERSONA-BLOCK\n", "utf8");
    writeFileSync(join(dir, "MEMORY.md"), "INDEX-BLOCK\n", "utf8");
    writeFileSync(join(dir, "preferences.md"), "PREFS-BLOCK\n", "utf8");
    writeFileSync(join(dir, "observations.md"), "OBS-BLOCK\n", "utf8");

    const out = buildSystemPrompt({ memoryDir: dir });
    const iPersona = out.indexOf("PERSONA-BLOCK");
    const iIndex = out.indexOf("INDEX-BLOCK");
    const iPrefs = out.indexOf("PREFS-BLOCK");
    const iObs = out.indexOf("OBS-BLOCK");
    const iRubric = out.indexOf(TOOL_RUBRIC);

    expect(iPersona).toBeGreaterThan(-1);
    expect(iPersona).toBeLessThan(iIndex);
    expect(iIndex).toBeLessThan(iPrefs);
    expect(iPrefs).toBeLessThan(iObs);
    expect(iObs).toBeLessThan(iRubric);
  });

  it("is byte-stable across runs (cache safety)", () => {
    mkdirSync(join(dir, "projects"), { recursive: true });
    writeFileSync(join(dir, "personality.md"), "P\n", "utf8");
    expect(buildSystemPrompt({ memoryDir: dir })).toBe(buildSystemPrompt({ memoryDir: dir }));
  });

  it("is byte-stable with observations present (cache safety)", () => {
    writeFileSync(join(dir, "personality.md"), "P\n", "utf8");
    writeFileSync(join(dir, "observations.md"),
      "- [2026-04-01 / high / preferences] uses pwsh\n", "utf8");
    const opts = { memoryDir: dir, today: "2026-04-28" };
    expect(buildSystemPrompt(opts)).toBe(buildSystemPrompt(opts));
  });

  it("omits a layer entirely when its file is absent or empty (no whitespace fingerprint)", () => {
    writeFileSync(join(dir, "personality.md"), "P\n", "utf8");
    const out = buildSystemPrompt({ memoryDir: dir });
    expect(out).not.toMatch(/INDEX-BLOCK/);
    expect(out).not.toMatch(/PREFS-BLOCK/);
    expect(out).not.toMatch(/OBS-BLOCK/);
    expect(out).not.toContain("# Memory index");
    expect(out).not.toContain("# Preferences");
    expect(out).not.toContain("# Observations");
    expect(out).toContain(TOOL_RUBRIC);
  });

  it("prunes observations when over the soft cap before rendering", () => {
    writeFileSync(join(dir, "personality.md"), "P\n", "utf8");
    const stale = Array.from({ length: 200 }, (_, i) =>
      `- [2026-01-01 / low / context] stale entry ${i} that is reasonably long`).join("\n");
    const fresh = "- [2026-04-28 / high / preferences] uses pwsh";
    writeFileSync(join(dir, "observations.md"), stale + "\n" + fresh + "\n", "utf8");

    const out = buildSystemPrompt({ memoryDir: dir, today: "2026-04-28" });
    expect(out).toContain("uses pwsh");
    expect(out).not.toContain("stale entry 199");
  });

  it("bootstraps the memory dir defensively when persona is missing", () => {
    // Caller skipped server-start bootstrap (test/script path). Persona must
    // still arrive — buildSystemPrompt is the last line of defense.
    const out = buildSystemPrompt({ memoryDir: dir });
    expect(out).toContain(PERSONALITY_MD.split("\n")[0]!);
  });

  it("appends a project-context layer after the rubric when supplied (mid-run mutation point)", () => {
    writeFileSync(join(dir, "personality.md"), "P\n", "utf8");
    const out = buildSystemPrompt({ memoryDir: dir, projectContext: "PROJ-BLOCK" });
    const iRubric = out.indexOf(TOOL_RUBRIC);
    const iProj = out.indexOf("PROJ-BLOCK");
    expect(iProj).toBeGreaterThan(iRubric);
  });
});
