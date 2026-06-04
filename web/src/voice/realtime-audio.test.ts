import { describe, it, expect } from "vitest";
import { pcm16Base64ToFloat32 } from "./realtime-audio.js";

// Encode signed-16-bit-LE samples to base64 the way the realtime API does, so we
// can assert the decode is exact.
function pcm16ToBase64(samples: number[]): string {
  const buf = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buf);
  samples.forEach((s, i) => view.setInt16(i * 2, s, true));
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

describe("pcm16Base64ToFloat32", () => {
  it("decodes silence to zeros", () => {
    const out = pcm16Base64ToFloat32(pcm16ToBase64([0, 0, 0]));
    expect(Array.from(out)).toEqual([0, 0, 0]);
  });

  it("maps full-scale +/- to ~+/-1.0", () => {
    const out = pcm16Base64ToFloat32(pcm16ToBase64([32767, -32768]));
    expect(out[0]).toBeCloseTo(1, 4);
    expect(out[1]).toBeCloseTo(-1, 4);
  });

  it("is little-endian (low byte first)", () => {
    // 0x0100 LE = 256
    const out = pcm16Base64ToFloat32(pcm16ToBase64([256]));
    expect(out[0]).toBeCloseTo(256 / 0x7fff, 6);
  });

  it("returns an empty array for an empty chunk", () => {
    expect(pcm16Base64ToFloat32("").length).toBe(0);
  });
});
