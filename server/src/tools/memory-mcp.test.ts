import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMemoryTools } from "./memory-mcp.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ava-mtools-"));
  mkdirSync(join(dir, "projects"), { recursive: true });
});

const ctx = { runId: "r1" };

describe("memory_read", () => {
  it("file=preferences returns the file content", async () => {
    writeFileSync(join(dir, "preferences.md"), "likes pwsh\n", "utf8");
    const tools = buildMemoryTools({ memoryDir: dir });
    const t = tools.find((x) => x.tool.name === "memory_read")!;
    const r = await t.run({ file: "preferences" }, ctx);
    expect(r.ok).toBe(true);
    expect(r.text).toBe("likes pwsh\n");
  });

  it("file=observations returns the file content", async () => {
    writeFileSync(join(dir, "observations.md"), "- [2026-04-28 / low / context] foo\n", "utf8");
    const tools = buildMemoryTools({ memoryDir: dir });
    const t = tools.find((x) => x.tool.name === "memory_read")!;
    const r = await t.run({ file: "observations" }, ctx);
    expect(r.ok).toBe(true);
    expect(r.text).toContain("foo");
  });

  it("file=project requires a slug and returns the per-project file", async () => {
    writeFileSync(join(dir, "projects", "yov.md"), "# yov notes", "utf8");
    const tools = buildMemoryTools({ memoryDir: dir });
    const t = tools.find((x) => x.tool.name === "memory_read")!;
    const r = await t.run({ file: "project", project: "yov" }, ctx);
    expect(r.ok).toBe(true);
    expect(r.text).toContain("yov notes");
  });

  it("file=project errors when project slug is missing", async () => {
    const tools = buildMemoryTools({ memoryDir: dir });
    const t = tools.find((x) => x.tool.name === "memory_read")!;
    const r = await t.run({ file: "project" }, ctx);
    expect(r.ok).toBe(false);
    expect(r.text).toContain("project");
  });

  it("file=all concatenates preferences + observations + index", async () => {
    writeFileSync(join(dir, "preferences.md"), "PREFS\n", "utf8");
    writeFileSync(join(dir, "observations.md"), "OBS\n", "utf8");
    writeFileSync(join(dir, "MEMORY.md"), "INDEX\n", "utf8");
    const tools = buildMemoryTools({ memoryDir: dir });
    const t = tools.find((x) => x.tool.name === "memory_read")!;
    const r = await t.run({ file: "all" }, ctx);
    expect(r.text).toContain("PREFS");
    expect(r.text).toContain("OBS");
    expect(r.text).toContain("INDEX");
  });
});
