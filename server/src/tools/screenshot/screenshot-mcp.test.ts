import { describe, it, expect } from "vitest";
import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildScreenshotTool } from "./screenshot-mcp.js";
import type { CaptureFn } from "./screenshot.js";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const fakeCapture: CaptureFn = async (p) => { await fsp.writeFile(p, PNG_BYTES); };

describe("buildScreenshotTool", () => {
  it("exposes a tool named take_screenshot", () => {
    const t = buildScreenshotTool();
    expect(t.tool.name).toBe("take_screenshot");
  });

  it("returns a success message with the saved .png path", async () => {
    const base = join(tmpdir(), `ava-shot-mcp-${process.pid}`);
    await fsp.rm(base, { recursive: true, force: true });
    const t = buildScreenshotTool({ capture: fakeCapture, baseDir: base });
    const r = await t.run({});
    expect(r.ok).toBe(true);
    expect(r.text).toContain(".png");
    expect(r.text).toContain("image/png");
    await fsp.rm(base, { recursive: true, force: true });
  });

  it("returns a structured error when the path is disallowed", async () => {
    const base = join(tmpdir(), `ava-shot-mcp2-${process.pid}`);
    const t = buildScreenshotTool({ capture: fakeCapture, baseDir: base });
    const r = await t.run({ path: join(tmpdir(), "evil.png") });
    expect(r.ok).toBe(false);
    expect(r.text).toContain("disallowed_path");
  });

  it("surfaces capture-backend failures as an error result", async () => {
    const base = join(tmpdir(), `ava-shot-mcp3-${process.pid}`);
    const t = buildScreenshotTool({
      capture: async () => { throw new Error("display gone"); },
      baseDir: base,
    });
    const r = await t.run({});
    expect(r.ok).toBe(false);
    expect(r.text).toContain("capture_failed");
  });
});
