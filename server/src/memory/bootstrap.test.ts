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
    // Persona v2 is intentionally compact: identity only. Collaboration,
    // contextual delivery and tool authority are separate prompt layers.
    expect(bytes).toBe(2409);
  });

  it("upgrades an untouched copy of the previous template to the current one", () => {
    writeFileSync(join(dir, "personality.md"), PREVIOUS_PERSONALITY_TEMPLATES[0]!, "utf8");
    bootstrapMemoryDir({ dir });
    expect(readFileSync(join(dir, "personality.md"), "utf8")).toBe(PERSONALITY_MD);
  });

  it("keeps an owner-edited copy of the previous template exactly as it is", () => {
    const edited = PREVIOUS_PERSONALITY_TEMPLATES[0]!.replace("Poised", "Calm");
    writeFileSync(join(dir, "personality.md"), edited, "utf8");
    bootstrapMemoryDir({ dir });
    expect(readFileSync(join(dir, "personality.md"), "utf8")).toBe(edited);
  });

  it("describes AVA as a personal assistant whose PC control is a tool, not her identity", () => {
    expect(PERSONALITY_MD).toContain("Niko's personal assistant");
    expect(PERSONALITY_MD).toContain("university work");
    expect(PERSONALITY_MD.replace(/\s+/g, " ")).toContain("I am not a computer manager");
    expect(PERSONALITY_MD).not.toContain("right hand on his Windows PC");
  });
});
