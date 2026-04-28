import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile, writeFile, appendLine } from "./store.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ava-store-")); });

describe("memory/store", () => {
  it("readFile returns '' when the file does not exist", () => {
    expect(readFile(join(dir, "missing.md"))).toBe("");
  });

  it("readFile returns content when present", () => {
    writeFileSync(join(dir, "x.md"), "hello", "utf8");
    expect(readFile(join(dir, "x.md"))).toBe("hello");
  });

  it("writeFile scrubs secrets before persisting", () => {
    writeFile(join(dir, "obs.md"), "key=sk-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    expect(readFileSync(join(dir, "obs.md"), "utf8")).toBe("key=sk-***");
  });

  it("appendLine appends a newline-terminated line, scrubbing first", () => {
    writeFileSync(join(dir, "obs.md"), "first\n", "utf8");
    appendLine(join(dir, "obs.md"), "Bearer eyJabc.def.ghi");
    expect(readFileSync(join(dir, "obs.md"), "utf8")).toBe("first\nBearer ***\n");
  });

  it("appendLine creates the file when absent", () => {
    appendLine(join(dir, "new.md"), "hello");
    expect(readFileSync(join(dir, "new.md"), "utf8")).toBe("hello\n");
  });
});
