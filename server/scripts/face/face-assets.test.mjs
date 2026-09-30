import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  encodeFaceAsset,
  expectedFaceAssetBytes,
  sha256,
  validateFaceAsset,
  validateFaceManifest,
} from "./face-asset-format.mjs";
import {
  assertPrivateInputBoundary,
  cropDepthRaster,
  publishFaceAsset,
  transformLandmarksAndFit,
} from "./face-build-utils.mjs";
import { generatePointSet, maximumNormalisedHistogramDelta } from "./face-sampling.mjs";
import { verifyPinnedFile } from "./face-models.mjs";

function points(count, offset = 0) {
  const u = new Float32Array(count);
  const v = new Float32Array(count);
  const tone = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) {
    u[index] = ((index * 17 + offset) % 97) / 96;
    v[index] = ((index * 29 + offset) % 89) / 88;
    tone[index] = (index * 31 + offset) % 256;
  }
  return { u, v, tone };
}

function landmarks() {
  return Array.from({ length: 478 }, (_, index) => ({
    x: 0.2 + (index % 22) / 40,
    y: 0.2 + Math.floor(index / 22) / 40,
    z: -0.1 + index / 4_780,
  }));
}

function fixture(overrides = {}) {
  return {
    stipple: points(96),
    glow: points(48, 7),
    landmarks: landmarks(),
    depth: Uint8Array.from({ length: 16 * 16 }, (_, index) => index),
    depthSize: 16,
    crop: { cx: 0.5, cy: 0.5, halfX: 0.4, halfY: 0.4 },
    depthFit: { a: -0.001, b: 0.12 },
    seed: 0x41564131,
    ...overrides,
  };
}

function manifestFor(binary, overrides = {}) {
  const digest = sha256(binary);
  return {
    schema: 1,
    version: "test",
    file: `ava-face.${digest.slice(0, 8)}.bin`,
    sha256: digest,
    bytes: binary.length,
    seed: 0x41564131,
    counts: { stipple: 96, glow: 48, landmarks: 478, depthSize: 16 },
    models: [
      { name: "landmark", version: "test", sha256: "1".repeat(64) },
      { name: "depth", version: "test", sha256: "2".repeat(64) },
    ],
    licences: [
      { name: "landmark", licence: "Apache-2.0" },
      { name: "depth", licence: "Apache-2.0" },
    ],
    source: "private AI portrait (not committed)",
    ...overrides,
  };
}

test("binary writer and validator preserve the exact v1 layout", () => {
  const binary = encodeFaceAsset(fixture());
  assert.equal(binary.length, expectedFaceAssetBytes({ stipple: 96, glow: 48, landmarks: 478, depthSize: 16 }));
  const parsed = validateFaceAsset(binary);
  assert.deepEqual(
    { stipple: parsed.stipple, glow: parsed.glow, landmarks: parsed.landmarks, depthSize: parsed.depthSize, seed: parsed.seed },
    { stipple: 96, glow: 48, landmarks: 478, depthSize: 16, seed: 0x41564131 },
  );
  assert.equal(parsed.crop.cx, 0.5);
  assert.doesNotThrow(() => validateFaceManifest(manifestFor(binary), binary));
});

test("validator rejects corruption, non-zero reserved bytes, truncation and manifest drift", () => {
  const binary = encodeFaceAsset(fixture());
  const badMagic = Buffer.from(binary);
  badMagic[0] = 0;
  assert.throws(() => validateFaceAsset(badMagic), /magic/);
  const badReserved = Buffer.from(binary);
  badReserved[58] = 1;
  assert.throws(() => validateFaceAsset(badReserved), /reserved/);
  assert.throws(() => validateFaceAsset(binary.subarray(0, -1)), /expected exactly/);
  assert.throws(() => validateFaceManifest(manifestFor(binary, { sha256: "0".repeat(64) }), binary), /SHA-256/);
});

test("point generation is deterministic and its proportional order keeps prefixes spatially representative", () => {
  const size = 64;
  const luminance = new Uint8Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) luminance[y * size + x] = 20 + ((x * 3 + y * 5) % 220);
  }
  const left = generatePointSet({ luminance, size, count: 2_000, seed: 1234, mode: "stipple", iterations: 2 });
  const right = generatePointSet({ luminance, size, count: 2_000, seed: 1234, mode: "stipple", iterations: 2 });
  assert.deepEqual([...left.u], [...right.u]);
  assert.deepEqual([...left.v], [...right.v]);
  assert.deepEqual([...left.tone], [...right.tone]);
  assert.ok(maximumNormalisedHistogramDelta(left, 1_400) <= 0.006, "prefix histogram should track the complete set");
});

test("depth crop and landmark fit are finite and deterministic", () => {
  const width = 32;
  const height = 32;
  const data = Uint8Array.from({ length: width * height }, (_, index) => index % width * 8);
  const depth = { width, height, data };
  const crop = { cx: 0.5, cy: 0.5, halfX: 0.4, halfY: 0.4 };
  const cropped = cropDepthRaster(depth, crop, 16);
  assert.equal(cropped.length, 256);
  const raw = Array.from({ length: 478 }, (_, index) => {
    const x = 0.1 + (index % 22) / 28;
    return { x, y: 0.1 + Math.floor(index / 22) / 28, z: 0.2 - x * 0.4 };
  });
  const fit = transformLandmarksAndFit(raw, depth, crop);
  assert.equal(fit.landmarks.length, 478);
  assert.ok(Number.isFinite(fit.depthFit.a));
  assert.ok(Number.isFinite(fit.depthFit.b));
  assert.ok(Math.abs(fit.correlation) > 0.95);
});

test("atomic publisher retains only the verified pair and never copies the private source", async () => {
  const root = await mkdtemp(join(tmpdir(), "ava-face-test-"));
  const output = join(root, "public-face");
  const privateSource = join(root, "portrait-private.png");
  await writeFile(privateSource, "private-pixels-must-not-ship");
  try {
    assert.doesNotThrow(() => assertPrivateInputBoundary(privateSource, output));
    assert.throws(() => assertPrivateInputBoundary(join(output, "source.png"), output), /private input/);
    const firstBinary = encodeFaceAsset(fixture());
    const first = await publishFaceAsset(output, firstBinary, manifestFor(firstBinary, {
      file: undefined,
      sha256: undefined,
      bytes: undefined,
    }));
    assert.equal(first.manifest.sha256, sha256(firstBinary));
    const secondBinary = encodeFaceAsset(fixture({ seed: 77 }));
    const second = await publishFaceAsset(output, secondBinary, manifestFor(secondBinary, {
      file: undefined,
      sha256: undefined,
      bytes: undefined,
      seed: 77,
    }));
    const files = (await readdir(output)).sort();
    assert.deepEqual(files, [second.manifest.file, "manifest.json"].sort());
    assert.ok(!(await readFile(join(output, second.manifest.file))).includes(Buffer.from("private-pixels")));
    assert.equal(await readFile(privateSource, "utf8"), "private-pixels-must-not-ship");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("pinned model boundary fails closed for missing and corrupt files", async () => {
  const root = await mkdtemp(join(tmpdir(), "ava-face-model-test-"));
  const model = join(root, "model.bin");
  try {
    await assert.rejects(
      verifyPinnedFile(model, 3, sha256(Buffer.from("abc")), "fixture model"),
      /missing/,
    );
    await writeFile(model, "abd");
    await assert.rejects(
      verifyPinnedFile(model, 3, sha256(Buffer.from("abc")), "fixture model"),
      /SHA-256/,
    );
    await writeFile(model, "abc");
    await assert.doesNotReject(
      verifyPinnedFile(model, 3, sha256(Buffer.from("abc")), "fixture model"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
