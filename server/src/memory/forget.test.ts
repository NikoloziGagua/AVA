import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryPaths } from "./paths.js";
import { forgetLast, forgetMatch, forgetProject } from "./forget.js";

let dir: string;
let p: ReturnType<typeof memoryPaths>;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ava-forget-"));
  p = memoryPaths(dir);
  mkdirSync(p.projectsDir, { recursive: true });
});

describe("forgetLast", () => {
  it("drops the most recent observation line", () => {
    writeFileSync(p.observations,
      "- [2026-04-28 / low / context] foo\n- [2026-04-28 / medium / context] bar\n", "utf8");
    const r = forgetLast({ paths: p });
    expect(r.dropped).toBe("- [2026-04-28 / medium / context] bar");
    expect(readFileSync(p.observations, "utf8")).toBe(
      "- [2026-04-28 / low / context] foo\n");
  });

  it("returns dropped=null when there are no observations", () => {
    const r = forgetLast({ paths: p });
    expect(r.dropped).toBeNull();
  });

  it("skips superseded observations and drops the last active one", () => {
    writeFileSync(p.observations,
      "- [2026-04-20 / low / context] foo\n" +
      "- [2026-04-21 / medium / context] bar\n" +
      "- [2026-01-12 / high / context / superseded 2026-04-28] old\n", "utf8");
    const r = forgetLast({ paths: p });
    expect(r.dropped).toBe("- [2026-04-21 / medium / context] bar");
    expect(readFileSync(p.observations, "utf8")).toBe(
      "- [2026-04-20 / low / context] foo\n" +
      "- [2026-01-12 / high / context / superseded 2026-04-28] old\n");
  });
});

describe("forgetMatch", () => {
  it("drops a uniquely matching observation", () => {
    writeFileSync(p.observations,
      "- [2026-04-28 / low / context] uses pwsh\n- [2026-04-28 / low / context] uses VS Code\n", "utf8");
    const r = forgetMatch({ paths: p, target: "pwsh" });
    expect(r.status).toBe("dropped");
    expect(readFileSync(p.observations, "utf8")).toBe(
      "- [2026-04-28 / low / context] uses VS Code\n");
  });

  it("reports ambiguity when multiple lines match", () => {
    writeFileSync(p.observations,
      "- [2026-04-28 / low / context] uses pwsh\n- [2026-04-28 / low / context] dislikes pwsh on macs\n", "utf8");
    const r = forgetMatch({ paths: p, target: "pwsh" });
    expect(r.status).toBe("ambiguous");
    if (r.status === "ambiguous") expect(r.candidates.length).toBe(2);
  });

  it("reports not_found when no match", () => {
    writeFileSync(p.observations, "- [2026-04-28 / low / context] foo\n", "utf8");
    expect(forgetMatch({ paths: p, target: "bar" }).status).toBe("not_found");
  });

  it("matches case-insensitively", () => {
    writeFileSync(p.observations,
      "- [2026-04-28 / low / context] uses pwsh\n", "utf8");
    const r = forgetMatch({ paths: p, target: "PWSH" });
    expect(r.status).toBe("dropped");
  });
});

describe("forgetProject", () => {
  it("removes the project file and any preferences/observations referencing the slug", () => {
    writeFileSync(p.projectFile("yov"), "# yov", "utf8");
    writeFileSync(p.preferences, "likes yov layout\nlikes dark mode\n", "utf8");
    writeFileSync(p.observations,
      "- [2026-04-28 / low / context] uses yov daily\n- [2026-04-28 / low / context] uses bash\n", "utf8");
    const r = forgetProject({ paths: p, slug: "yov" });
    expect(r.removedFile).toBe(true);
    expect(existsSync(p.projectFile("yov"))).toBe(false);
    expect(readFileSync(p.preferences, "utf8")).toBe("likes dark mode\n");
    expect(readFileSync(p.observations, "utf8")).toBe(
      "- [2026-04-28 / low / context] uses bash\n");
  });

  it("does not drop observations whose metadata bracket happens to contain the slug", () => {
    writeFileSync(p.observations,
      "- [2026-04-28 / low / context] uses bash\n" +
      "- [2026-04-28 / low / context] uses low-power mode\n", "utf8");
    const r = forgetProject({ paths: p, slug: "low" });
    expect(r.removedFile).toBe(false);
    expect(readFileSync(p.observations, "utf8")).toBe(
      "- [2026-04-28 / low / context] uses bash\n");
  });
});
