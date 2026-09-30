import { describe, expect, it, vi } from "vitest";
import { expectedLength, FaceAssetError, loadFaceAsset, parseFaceAsset } from "./asset.js";
import { buildFaceAsset } from "./fixture.test-helper.js";

function corrupt(buffer: ArrayBuffer, edit: (view: DataView) => void): ArrayBuffer {
  const copy = buffer.slice(0);
  edit(new DataView(copy));
  return copy;
}

function codeOf(run: () => unknown): string | null {
  try { run(); return null; } catch (error) { return error instanceof FaceAssetError ? error.code : "other"; }
}

describe("parseFaceAsset", () => {
  it("reads a valid asset in crop-local coordinates", () => {
    const asset = parseFaceAsset(buildFaceAsset({ stipple: 12, glow: 9, depthSize: 16, crop: [0.48, 0.52, 0.4, 0.38] }));
    expect(asset.stipple.count).toBe(12);
    expect(asset.glow.count).toBe(9);
    expect(asset.landmarks.length).toBe(478 * 3);
    expect(asset.depth.length).toBe(256);
    expect(asset.crop.halfY).toBeCloseTo(0.38, 5);
    for (let i = 0; i < asset.stipple.count; i++) {
      expect(asset.stipple.u(i)).toBeGreaterThanOrEqual(0);
      expect(asset.stipple.u(i)).toBeLessThanOrEqual(1);
      expect(asset.stipple.tone(i)).toBeLessThanOrEqual(1);
    }
  });

  it("aligns the float landmarks after an odd number of point bytes", () => {
    // 5·(1 + 2) = 15 point bytes → 1 pad byte before the landmarks.
    expect(expectedLength(1, 2, 478, 16)).toBe(64 + 15 + 1 + 478 * 12 + 256);
    expect(() => parseFaceAsset(buildFaceAsset({ stipple: 1, glow: 2 }))).not.toThrow();
  });

  it("rejects every malformed header before exposing data", () => {
    const good = buildFaceAsset();
    expect(codeOf(() => parseFaceAsset(corrupt(good, (v) => v.setUint8(0, 0x58))))).toBe("bad_magic");
    expect(codeOf(() => parseFaceAsset(corrupt(good, (v) => v.setUint16(4, 2, true))))).toBe("bad_version");
    expect(codeOf(() => parseFaceAsset(corrupt(good, (v) => v.setUint16(6, 1, true))))).toBe("bad_flags");
    expect(codeOf(() => parseFaceAsset(corrupt(good, (v) => v.setUint32(16, 468, true))))).toBe("bad_counts");
    expect(codeOf(() => parseFaceAsset(corrupt(good, (v) => v.setUint32(8, 0, true))))).toBe("bad_counts");
    expect(codeOf(() => parseFaceAsset(corrupt(good, (v) => v.setUint16(22, 1, true))))).toBe("bad_reserved");
    expect(codeOf(() => parseFaceAsset(corrupt(good, (v) => v.setUint8(60, 1))))).toBe("bad_reserved");
    expect(codeOf(() => parseFaceAsset(corrupt(good, (v) => v.setFloat32(32, 0, true))))).toBe("bad_crop");
    expect(codeOf(() => parseFaceAsset(corrupt(good, (v) => v.setFloat32(24, 0.95, true))))).toBe("bad_crop");
    expect(codeOf(() => parseFaceAsset(corrupt(good, (v) => v.setFloat32(40, Number.NaN, true))))).toBe("bad_fit");
  });

  it("rejects a file whose length differs from its header by even one byte", () => {
    const good = buildFaceAsset();
    expect(codeOf(() => parseFaceAsset(good.slice(0, good.byteLength - 1)))).toBe("bad_length");
    const longer = new Uint8Array(good.byteLength + 1);
    longer.set(new Uint8Array(good));
    expect(codeOf(() => parseFaceAsset(longer.buffer))).toBe("bad_length");
    expect(codeOf(() => parseFaceAsset(new ArrayBuffer(10)))).toBe("bad_length");
  });
});

describe("loadFaceAsset", () => {
  async function sha(buffer: ArrayBuffer) {
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  function fakeFetch(manifest: unknown, body: ArrayBuffer) {
    return vi.fn(async (url: string) => {
      if (url.endsWith("manifest.json")) return new Response(JSON.stringify(manifest), { status: 200 });
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;
  }

  it("loads the exact file the manifest names after verifying size and hash", async () => {
    const body = buildFaceAsset();
    const manifest = { schema: 1, file: "ava-face.0123abcd.bin", sha256: await sha(body), bytes: body.byteLength };
    const fetcher = fakeFetch(manifest, body);
    const asset = await loadFaceAsset("/face/", fetcher);
    expect(asset.bytes).toBe(body.byteLength);
    expect(fetcher).toHaveBeenCalledWith("/face/ava-face.0123abcd.bin");
  });

  it("refuses a body that does not match the manifest hash", async () => {
    const body = buildFaceAsset();
    const manifest = { schema: 1, file: "ava-face.0123abcd.bin", sha256: "0".repeat(64), bytes: body.byteLength };
    await expect(loadFaceAsset("/face/", fakeFetch(manifest, body))).rejects.toMatchObject({ code: "bad_hash" });
  });

  it("refuses a manifest that could point anywhere else", async () => {
    const body = buildFaceAsset();
    const manifest = { schema: 1, file: "../../etc/secret", sha256: await sha(body), bytes: body.byteLength };
    await expect(loadFaceAsset("/face/", fakeFetch(manifest, body))).rejects.toMatchObject({ code: "bad_manifest" });
  });

  it("reports a missing manifest as a fetch failure", async () => {
    const fetcher = vi.fn(async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    await expect(loadFaceAsset("/face/", fetcher)).rejects.toMatchObject({ code: "fetch_failed" });
  });
});
