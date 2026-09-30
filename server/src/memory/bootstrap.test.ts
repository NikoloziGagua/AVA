// server/src/memory/bootstrap.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Buffer } from "node:buffer";
import { bootstrapMemoryDir } from "./bootstrap.js";
import { PERSONALITY_MD, PREVIOUS_PERSONALITY_TEMPLATES } from "./personality-content.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ava-mem-"));
});

describe("bootstrapMemoryDir", () => {
  it("creates the memory dir and projects subdir if missing", () => {
    rmSync(dir, { recursive: true, force: true });
    bootstrapMemoryDir({ dir });
    expect(existsSync(dir)).toBe(true);
    expect(existsSync(join(dir, "projects"))).toBe(true);
  });

  it("writes personality.md verbatim when absent", () => {
    bootstrapMemoryDir({ dir });
    expect(readFileSync(join(dir, "personality.md"), "utf8")).toBe(PERSONALITY_MD);
  });

  it("does not overwrite an existing personality.md (Sir's edits win)", () => {
    writeFileSync(join(dir, "personality.md"), "# Sir's edits", "utf8");
    bootstrapMemoryDir({ dir });
    expect(readFileSync(join(dir, "personality.md"), "utf8")).toBe("# Sir's edits");
  });

  it("PERSONALITY_MD byte length is pinned (drift detection)", () => {
    const bytes = Buffer.byteLength(PERSONALITY_MD, "utf8");
    // Persona 3.1 adds "Care and curiosity" (Niko, 2026-09-27). Tool authority
    // remains a separate prompt layer. 30 Sep: "gym or jiu-jitsu", not running.
    expect(bytes).toBe(8177);
  });

  it.each(PREVIOUS_PERSONALITY_TEMPLATES.map((template, index) => [index, template] as const))(
    "upgrades untouched previous template %i to the current one",
    (_index, template) => {
      writeFileSync(join(dir, "personality.md"), template, "utf8");
      bootstrapMemoryDir({ dir });
      expect(readFileSync(join(dir, "personality.md"), "utf8")).toBe(PERSONALITY_MD);
    },
  );

  it("keeps an owner-edited copy of the previous template exactly as it is", () => {
    const edited = PREVIOUS_PERSONALITY_TEMPLATES[0]!.replace("Poised", "Calm");
    writeFileSync(join(dir, "personality.md"), edited, "utf8");
    bootstrapMemoryDir({ dir });
    expect(readFileSync(join(dir, "personality.md"), "utf8")).toBe(edited);
  });

  it("describes AVA as a grounded personal intelligence whose tools do not define her", () => {
    expect(PERSONALITY_MD).toContain("Niko's personal intelligence and assistant");
    expect(PERSONALITY_MD).toContain("university work");
    expect(PERSONALITY_MD).toContain("evidence I can actually access");
    expect(PERSONALITY_MD).toContain("Initiative is not permission");
    expect(PERSONALITY_MD.replace(/\s+/g, " ")).toContain("I am not a computer manager");
    expect(PERSONALITY_MD).not.toContain("right hand on his Windows PC");
  });

  it("cares and follows up without presuming what happened (persona 3.1)", () => {
    expect(PERSONALITY_MD).toContain("## Care and curiosity");
    const flat = PERSONALITY_MD.replace(/\s+/g, " ");
    expect(flat).toContain("A plan is not proof that something happened");
    expect(flat).toContain("Memory's consent and governance rules");
    expect(PERSONALITY_MD).toContain("launching businesses");
    expect(PERSONALITY_MD).toContain("I do not nag");
  });
});
