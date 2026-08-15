import { describe, expect, it, vi } from "vitest";
import type { Filesystem } from "./filesystem.js";
import { buildFilesystemTools } from "./filesystem-mcp.js";

function filesystem(overrides: Partial<Filesystem>): Filesystem {
  return {
    read: vi.fn().mockResolvedValue({ ok: true, content: "hello" }),
    write: vi.fn().mockResolvedValue({ ok: true }),
    list: vi.fn().mockResolvedValue({ ok: true, entries: [] }),
    stat: vi.fn().mockResolvedValue({ ok: true, size: 0, mtimeMs: 0, isDir: false }),
    delete: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
}

function writeTool(fs: Filesystem) {
  return buildFilesystemTools({ fs, emit: () => undefined })
    .find((item) => item.tool.name === "fs_write")!;
}

describe("fs_write verification evidence", () => {
  it("emits verified task-outcome evidence after exact readback", async () => {
    const result = await writeTool(filesystem({})).run({ path: "C:/safe/a.txt", content: "hello" });
    expect(result).toMatchObject({
      ok: true,
      verification: { state: "verified", scope: "task_outcome", method: "fs_readback" },
    });
  });

  it("reports verification unavailable when readback cannot run", async () => {
    const result = await writeTool(filesystem({
      read: vi.fn().mockResolvedValue({ ok: false, reason: "read denied" }),
    })).run({ path: "C:/safe/a.txt", content: "hello" });
    expect(result).toMatchObject({
      ok: true,
      verification: { state: "unavailable", method: "fs_readback" },
    });
  });

  it("contradicts the write result when readback differs", async () => {
    const result = await writeTool(filesystem({
      read: vi.fn().mockResolvedValue({ ok: true, content: "different" }),
    })).run({ path: "C:/safe/a.txt", content: "hello" });
    expect(result).toMatchObject({
      ok: false,
      verification: { state: "contradicted", method: "fs_readback" },
    });
  });
});
