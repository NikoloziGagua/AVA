import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildFilesystem } from "./filesystem.js";

describe("filesystem tool", () => {
  let root: string;
  let fs: ReturnType<typeof buildFilesystem>;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ava-fs-"));
    fs = buildFilesystem({ roots: [`${root.replace(/\\/g, "/")}/**`] });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("read returns file contents", async () => {
    const p = join(root, "hello.txt");
    writeFileSync(p, "hi");
    const r = await fs.read(p);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.content).toBe("hi");
  });

  it("read denies paths outside allowlist", async () => {
    const r = await fs.read("C:/Windows/System32/notepad.exe");
    expect(r.ok).toBe(false);
  });

  it("read hard-blocks .env", async () => {
    const p = join(root, ".env");
    writeFileSync(p, "SECRET=x");
    const r = await fs.read(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/env/i);
  });

  it("write creates a file", async () => {
    const p = join(root, "out.txt");
    const r = await fs.write(p, "data");
    expect(r.ok).toBe(true);
    expect(readFileSync(p, "utf8")).toBe("data");
  });

  it("write hard-blocks .env even when allowlisted", async () => {
    const p = join(root, "test.env");
    const r = await fs.write(p, "x");
    expect(r.ok).toBe(false);
  });

  it("list returns directory entries", async () => {
    writeFileSync(join(root, "a.txt"), "");
    mkdirSync(join(root, "sub"));
    const r = await fs.list(root);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const names = r.entries.map((e) => e.name).sort();
      expect(names).toEqual(["a.txt", "sub"]);
      const sub = r.entries.find((e) => e.name === "sub");
      expect(sub?.isDir).toBe(true);
    }
  });

  it("stat returns size + mtime", async () => {
    const p = join(root, "x.txt");
    writeFileSync(p, "hello");
    const r = await fs.stat(p);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.size).toBe(5);
      expect(typeof r.mtimeMs).toBe("number");
    }
  });

  it("delete removes a file", async () => {
    const p = join(root, "del.txt");
    writeFileSync(p, "");
    const r = await fs.delete(p);
    expect(r.ok).toBe(true);
    expect(existsSync(p)).toBe(false);
  });

  it("delete refuses .env", async () => {
    const p = join(root, ".env");
    writeFileSync(p, "");
    const r = await fs.delete(p);
    expect(r.ok).toBe(false);
    expect(existsSync(p)).toBe(true);
  });
});
