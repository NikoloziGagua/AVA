import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFaceAsset } from "./asset.js";
import { buildPoints, FLOATS } from "./model.js";

/** Shared acceptance (contract face-asset v1 §7): the committed asset parses in the web reader. */
const WEB = existsSync(join(process.cwd(), "public", "face")) ? process.cwd() : join(process.cwd(), "web");
const DIR = join(WEB, "public", "face");

describe("committed face asset", () => {
  const manifest = JSON.parse(readFileSync(join(DIR, "manifest.json"), "utf8")) as {
    file: string; sha256: string; bytes: number; counts: { stipple: number; glow: number; landmarks: number; depthSize: number };
  };
  const bytes = readFileSync(join(DIR, manifest.file));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

  it("matches its manifest byte-for-byte", () => {
    expect(bytes.byteLength).toBe(manifest.bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(manifest.sha256);
    expect(manifest.file).toBe(`ava-face.${manifest.sha256.slice(0, 8)}.bin`);
  });

  it("passes every reader check and yields finite renderable dots", () => {
    const asset = parseFaceAsset(buffer);
    expect(asset.stipple.count).toBe(manifest.counts.stipple);
    expect(asset.glow.count).toBe(manifest.counts.glow);
    expect(asset.depthSize).toBe(manifest.counts.depthSize);
    const built = buildPoints(asset, "glow", 2000);
    expect(built.data.length).toBe(2000 * FLOATS);
    expect([...built.data].every(Number.isFinite)).toBe(true);
    expect([...buildPoints(asset, "stipple", 2000).data].every(Number.isFinite)).toBe(true);
  });
});
