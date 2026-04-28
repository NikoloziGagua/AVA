// server/src/memory/bootstrap.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapMemoryDir } from "./bootstrap.js";
import { PERSONALITY_MD } from "./personality-content.js";

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
});
