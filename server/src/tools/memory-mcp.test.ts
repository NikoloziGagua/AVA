import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMemoryTools } from "./memory-mcp.js";
import { loadProjectIndex } from "../memory/project-index.js";

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

  it("file=project rejects path-traversal slugs", async () => {
    const tools = buildMemoryTools({ memoryDir: dir });
    const t = tools.find((x) => x.tool.name === "memory_read")!;
    const r = await t.run({ file: "project", project: "../../etc/passwd" }, ctx);
    expect(r.ok).toBe(false);
    expect(r.text).toContain("invalid project slug");
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

describe("memory_remember", () => {
  it("appends to observations.md by default with confidence=low", async () => {
    const tools = buildMemoryTools({ memoryDir: dir });
    const t = tools.find((x) => x.tool.name === "memory_remember")!;
    const r = await t.run({ text: "uses pwsh", category: "preferences", today: "2026-04-28" }, ctx);
    expect(r.ok).toBe(true);
    expect(readFileSync(join(dir, "observations.md"), "utf8"))
      .toBe("- [2026-04-28 / low / preferences] uses pwsh\n");
  });

  it("file=preferences appends a plain line to preferences.md (no confidence)", async () => {
    const tools = buildMemoryTools({ memoryDir: dir });
    const t = tools.find((x) => x.tool.name === "memory_remember")!;
    const r = await t.run({ file: "preferences", text: "prefers terse responses" }, ctx);
    expect(r.ok).toBe(true);
    expect(readFileSync(join(dir, "preferences.md"), "utf8")).toBe("prefers terse responses\n");
  });

  it("file=project requires a slug and appends to projects/<slug>.md", async () => {
    const tools = buildMemoryTools({ memoryDir: dir });
    const t = tools.find((x) => x.tool.name === "memory_remember")!;
    const r = await t.run({ file: "project", project: "yov", text: "uses C:/ai/yov" }, ctx);
    expect(r.ok).toBe(true);
    expect(readFileSync(join(dir, "projects", "yov.md"), "utf8")).toBe("uses C:/ai/yov\n");
    expect(readFileSync(join(dir, "MEMORY.md"), "utf8"))
      .toBe("- [yov](projects/yov.md)\n");
    expect(loadProjectIndex(dir)).toEqual([{ slug: "yov", roots: ["c:/ai/yov"] }]);
  });

  it("indexes a project only once across repeated writes", async () => {
    const tools = buildMemoryTools({ memoryDir: dir });
    const t = tools.find((x) => x.tool.name === "memory_remember")!;
    await t.run({ file: "project", project: "yov", text: "Root: C:/ai/yov" }, ctx);
    await t.run({ file: "project", project: "yov", text: "uses TypeScript" }, ctx);

    expect(readFileSync(join(dir, "MEMORY.md"), "utf8"))
      .toBe("- [yov](projects/yov.md)\n");
  });

  it("refresh=<substring> bumps the matching observation's confidence and date", async () => {
    writeFileSync(join(dir, "observations.md"),
      "- [2026-04-20 / low / preferences] uses pwsh for shell\n", "utf8");
    const tools = buildMemoryTools({ memoryDir: dir });
    const t = tools.find((x) => x.tool.name === "memory_remember")!;
    const r = await t.run({ refresh: "pwsh", today: "2026-04-28" }, ctx);
    expect(r.ok).toBe(true);
    expect(readFileSync(join(dir, "observations.md"), "utf8"))
      .toBe("- [2026-04-28 / medium / preferences] uses pwsh for shell\n");
  });

  it("supersedes=<substring> marks the old line and appends the new one", async () => {
    writeFileSync(join(dir, "observations.md"),
      "- [2026-01-12 / high / preferences] uses pwsh for shell\n", "utf8");
    const tools = buildMemoryTools({ memoryDir: dir });
    const t = tools.find((x) => x.tool.name === "memory_remember")!;
    const r = await t.run({
      text: "uses bash on macOS now", category: "preferences", confidence: "medium",
      supersedes: "pwsh", today: "2026-04-28",
    }, ctx);
    expect(r.ok).toBe(true);
    const out = readFileSync(join(dir, "observations.md"), "utf8");
    expect(out).toContain("/ superseded 2026-04-28] uses pwsh for shell");
    expect(out).toContain("- [2026-04-28 / medium / preferences] uses bash on macOS now");
  });

  it("scrubs secrets in the text before persisting (firewall)", async () => {
    const tools = buildMemoryTools({ memoryDir: dir });
    const t = tools.find((x) => x.tool.name === "memory_remember")!;
    await t.run({
      text: "OPENAI_API_KEY=sk-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      category: "setup", today: "2026-04-28",
    }, ctx);
    const persisted = readFileSync(join(dir, "observations.md"), "utf8");
    expect(persisted).not.toContain("sk-AAAA");
    expect(persisted).toContain("sk-***");
  });

  it("rejects refresh when file is not observations", async () => {
    const tools = buildMemoryTools({ memoryDir: dir });
    const t = tools.find((x) => x.tool.name === "memory_remember")!;
    const r = await t.run({ file: "preferences", refresh: "X" }, ctx);
    expect(r.ok).toBe(false);
    expect(r.text).toContain("refresh is only valid for file=observations");
  });

  it("rejects refresh combined with supersedes", async () => {
    writeFileSync(join(dir, "observations.md"),
      "- [2026-04-20 / low / preferences] uses pwsh for shell\n", "utf8");
    const tools = buildMemoryTools({ memoryDir: dir });
    const t = tools.find((x) => x.tool.name === "memory_remember")!;
    const r = await t.run({ refresh: "pwsh", supersedes: "pwsh", today: "2026-04-28" }, ctx);
    expect(r.ok).toBe(false);
    expect(r.text).toContain("mutually exclusive");
  });

  it("rejects invalid confidence values", async () => {
    const tools = buildMemoryTools({ memoryDir: dir });
    const t = tools.find((x) => x.tool.name === "memory_remember")!;
    const r = await t.run({
      text: "x", category: "context", confidence: "extreme", today: "2026-04-28",
    }, ctx);
    expect(r.ok).toBe(false);
    expect(r.text).toContain("invalid confidence");
  });
});

describe("memory_forget", () => {
  it("mode=last drops the most recent observation", async () => {
    writeFileSync(join(dir, "observations.md"),
      "- [2026-04-28 / low / context] foo\n- [2026-04-28 / low / context] bar\n", "utf8");
    const tools = buildMemoryTools({ memoryDir: dir });
    const t = tools.find((x) => x.tool.name === "memory_forget")!;
    const r = await t.run({ mode: "last" }, ctx);
    expect(r.ok).toBe(true);
    expect(readFileSync(join(dir, "observations.md"), "utf8"))
      .toBe("- [2026-04-28 / low / context] foo\n");
  });

  it("mode=match drops a uniquely matching line", async () => {
    writeFileSync(join(dir, "observations.md"),
      "- [2026-04-28 / low / context] uses pwsh\n- [2026-04-28 / low / context] uses VS Code\n", "utf8");
    const tools = buildMemoryTools({ memoryDir: dir });
    const t = tools.find((x) => x.tool.name === "memory_forget")!;
    const r = await t.run({ mode: "match", target: "pwsh" }, ctx);
    expect(r.ok).toBe(true);
    expect(readFileSync(join(dir, "observations.md"), "utf8"))
      .toBe("- [2026-04-28 / low / context] uses VS Code\n");
  });

  it("mode=match returns ok=false with candidates when ambiguous", async () => {
    writeFileSync(join(dir, "observations.md"),
      "- [2026-04-28 / low / context] uses pwsh\n- [2026-04-28 / low / context] hates pwsh\n", "utf8");
    const tools = buildMemoryTools({ memoryDir: dir });
    const t = tools.find((x) => x.tool.name === "memory_forget")!;
    const r = await t.run({ mode: "match", target: "pwsh" }, ctx);
    expect(r.ok).toBe(false);
    expect(r.text.toLowerCase()).toContain("ambiguous");
  });

  it("mode=project removes the project file and references", async () => {
    writeFileSync(join(dir, "projects", "yov.md"), "# yov", "utf8");
    writeFileSync(join(dir, "preferences.md"), "yov layout\n", "utf8");
    writeFileSync(join(dir, "MEMORY.md"), "- [yov](projects/yov.md)\n", "utf8");
    const tools = buildMemoryTools({ memoryDir: dir });
    const t = tools.find((x) => x.tool.name === "memory_forget")!;
    const r = await t.run({ mode: "project", target: "yov" }, ctx);
    expect(r.ok).toBe(true);
    expect(readFileSync(join(dir, "preferences.md"), "utf8")).toBe("");
    expect(readFileSync(join(dir, "MEMORY.md"), "utf8")).toBe("");
  });

  it("mode=match returns not_found when the only matching line is superseded", async () => {
    writeFileSync(join(dir, "observations.md"),
      "- [2026-04-20 / high / context / superseded 2026-04-28] uses pwsh\n" +
      "- [2026-04-28 / medium / context] uses bash\n", "utf8");
    const tools = buildMemoryTools({ memoryDir: dir });
    const t = tools.find((x) => x.tool.name === "memory_forget")!;
    const r = await t.run({ mode: "match", target: "pwsh" }, ctx);
    expect(r.ok).toBe(false);
    expect(r.text).toContain("not found");
  });
});
