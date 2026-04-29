import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapMemoryDir } from "./bootstrap.js";
import { loadProjectIndex, detectProject, readProjectFile } from "./project-index.js";

function setup(): string {
  const dir = mkdtempSync(join(tmpdir(), "ava-projidx-"));
  bootstrapMemoryDir({ dir });
  return dir;
}

describe("project-index", () => {
  it("returns empty when MEMORY.md is missing", () => {
    const dir = setup();
    expect(loadProjectIndex(dir)).toEqual([]);
  });

  it("loads slugs referenced from MEMORY.md and parses their absolute paths", () => {
    const dir = setup();
    writeFileSync(
      join(dir, "MEMORY.md"),
      "- [yov](projects/yov.md) — main work project\n- [other](projects/other.md) — second\n",
      "utf8",
    );
    mkdirSync(join(dir, "projects"), { recursive: true });
    writeFileSync(
      join(dir, "projects", "yov.md"),
      "Root: C:/ai/chemiapebi/yovlisshemdzle\n",
      "utf8",
    );
    writeFileSync(
      join(dir, "projects", "other.md"),
      "lives at /home/sir/other\n",
      "utf8",
    );
    const idx = loadProjectIndex(dir);
    expect(idx).toHaveLength(2);
    const yov = idx.find((e) => e.slug === "yov");
    expect(yov?.roots).toContain("c:/ai/chemiapebi/yovlisshemdzle");
    const other = idx.find((e) => e.slug === "other");
    expect(other?.roots).toContain("/home/sir/other");
  });

  it("skips slugs whose project file is missing or empty", () => {
    const dir = setup();
    writeFileSync(join(dir, "MEMORY.md"), "- [missing](projects/missing.md)\n", "utf8");
    expect(loadProjectIndex(dir)).toEqual([]);
  });

  it("detectProject finds longest match in text (windows path)", () => {
    const dir = setup();
    writeFileSync(
      join(dir, "MEMORY.md"),
      "- [yov](projects/yov.md)\n- [yovsub](projects/yovsub.md)\n",
      "utf8",
    );
    mkdirSync(join(dir, "projects"), { recursive: true });
    writeFileSync(join(dir, "projects", "yov.md"), "C:/ai/chemiapebi/yovlisshemdzle\n", "utf8");
    writeFileSync(
      join(dir, "projects", "yovsub.md"),
      "C:/ai/chemiapebi/yovlisshemdzle/server\n",
      "utf8",
    );
    const idx = loadProjectIndex(dir);
    const r = detectProject("read C:\\ai\\chemiapebi\\yovlisshemdzle\\server\\package.json", idx);
    expect(r?.slug).toBe("yovsub"); // longer root wins
  });

  it("detectProject returns null when no match", () => {
    const dir = setup();
    writeFileSync(join(dir, "MEMORY.md"), "- [yov](projects/yov.md)\n", "utf8");
    mkdirSync(join(dir, "projects"), { recursive: true });
    writeFileSync(join(dir, "projects", "yov.md"), "C:/ai/yov\n", "utf8");
    const idx = loadProjectIndex(dir);
    expect(detectProject("hi how are you", idx)).toBeNull();
  });

  it("detectProject is case-insensitive", () => {
    const dir = setup();
    writeFileSync(join(dir, "MEMORY.md"), "- [yov](projects/yov.md)\n", "utf8");
    mkdirSync(join(dir, "projects"), { recursive: true });
    writeFileSync(join(dir, "projects", "yov.md"), "C:/AI/Chemiapebi/YovLisshemdzle\n", "utf8");
    const idx = loadProjectIndex(dir);
    expect(detectProject("c:/ai/chemiapebi/yovlisshemdzle/x", idx)?.slug).toBe("yov");
  });

  it("ignores invalid slugs in MEMORY.md", () => {
    const dir = setup();
    writeFileSync(join(dir, "MEMORY.md"), "- [bad](projects/-bad.md)\n", "utf8");
    expect(loadProjectIndex(dir)).toEqual([]);
  });

  it("readProjectFile returns project body or empty string", () => {
    const dir = setup();
    mkdirSync(join(dir, "projects"), { recursive: true });
    writeFileSync(join(dir, "projects", "yov.md"), "Notes for yov.\n", "utf8");
    expect(readProjectFile(dir, "yov")).toContain("Notes for yov.");
    expect(readProjectFile(dir, "missing")).toBe("");
    expect(readProjectFile(dir, "../bad")).toBe(""); // invalid slug → empty
  });
});
