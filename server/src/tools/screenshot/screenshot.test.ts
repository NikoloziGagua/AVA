import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { takeScreenshot, screenshotDir, type CaptureFn } from "./screenshot.js";

// A valid-enough PNG: the 8-byte signature followed by some payload. The tool
// only validates the signature + byte count, not full chunk structure.
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("IDAT-fake-payload"),
]);

/** Capture backend that writes a real PNG to the requested path. */
const fakeCapture: CaptureFn = async (outPath) => {
  await fsp.writeFile(outPath, PNG_BYTES);
};

let base: string;

beforeEach(async () => {
  base = join(tmpdir(), `ava-shot-${process.pid}-${Math.floor(performance.now())}`);
});

afterEach(async () => {
  await fsp.rm(base, { recursive: true, force: true });
});

describe("takeScreenshot", () => {
  it("creates the directory if it does not exist", async () => {
    await expect(fsp.stat(base)).rejects.toThrow();
    const r = await takeScreenshot({ baseDir: base, capture: fakeCapture, now: 111 });
    expect(r.ok).toBe(true);
    const st = await fsp.stat(base);
    expect(st.isDirectory()).toBe(true);
  });

  it("saves under the base dir with a .png extension and returns the path", async () => {
    const r = await takeScreenshot({ baseDir: base, capture: fakeCapture, now: 222 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.path).toBe(join(base, "screenshot-222.png"));
    expect(r.path.toLowerCase().endsWith(".png")).toBe(true);
    await expect(fsp.stat(r.path)).resolves.toBeTruthy();
  });

  it("returns PNG mime type and the real byte count", async () => {
    const r = await takeScreenshot({ baseDir: base, capture: fakeCapture });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mimeType).toBe("image/png");
    expect(r.bytes).toBe(PNG_BYTES.length);
  });

  it("honours an explicit path that resolves inside the screenshots dir", async () => {
    const inside = join(base, "sub", "shot.png");
    const r = await takeScreenshot({ baseDir: base, path: inside, capture: fakeCapture });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(resolve(r.path)).toBe(resolve(inside));
  });

  it("rejects a path that escapes the screenshots dir (traversal)", async () => {
    const outside = join(base, "..", "escape.png");
    const r = await takeScreenshot({ baseDir: base, path: outside, capture: fakeCapture });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("disallowed_path");
  });

  it("rejects an absolute path to a disallowed directory", async () => {
    const r = await takeScreenshot({
      baseDir: base,
      path: join(tmpdir(), "elsewhere.png"),
      capture: fakeCapture,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("disallowed_path");
  });

  it("rejects a non-png explicit path", async () => {
    const r = await takeScreenshot({
      baseDir: base,
      path: join(base, "shot.jpg"),
      capture: fakeCapture,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("disallowed_path");
  });

  it("returns a clear failure result when the capture backend throws", async () => {
    const r = await takeScreenshot({
      baseDir: base,
      capture: async () => { throw new Error("boom: no display"); },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("capture_failed");
    expect(r.error.message).toContain("boom");
  });

  it("flags a captured file that is not a valid PNG", async () => {
    const r = await takeScreenshot({
      baseDir: base,
      capture: async (p) => { await fsp.writeFile(p, "not a png"); },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("capture_failed");
  });
});

describe("screenshotDir", () => {
  it("resolves under Downloads/Ava/screenshots of the given home", () => {
    const dir = screenshotDir("C:/Users/test").replace(/\\/g, "/");
    expect(dir).toBe("C:/Users/test/Downloads/Ava/screenshots");
  });
});
