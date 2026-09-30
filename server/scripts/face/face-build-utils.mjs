import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { sha256, validateFaceManifest } from "./face-asset-format.mjs";

function invariant(condition, message) {
  if (!condition) throw new Error(`face asset build failed: ${message}`);
}

function sampleByte(image, width, height, x, y) {
  const clampedX = Math.max(0, Math.min(width - 1, x));
  const clampedY = Math.max(0, Math.min(height - 1, y));
  const left = Math.floor(clampedX);
  const top = Math.floor(clampedY);
  const right = Math.min(width - 1, left + 1);
  const bottom = Math.min(height - 1, top + 1);
  const fx = clampedX - left;
  const fy = clampedY - top;
  const upper = image[top * width + left] * (1 - fx) + image[top * width + right] * fx;
  const lower = image[bottom * width + left] * (1 - fx) + image[bottom * width + right] * fx;
  return upper * (1 - fy) + lower * fy;
}

export function cropDepthRaster(depth, crop, outputSize) {
  invariant(depth.data.length === depth.width * depth.height, "depth source dimensions do not match");
  invariant(Number.isInteger(outputSize) && outputSize > 0, "depth output size is invalid");
  const output = new Uint8Array(outputSize * outputSize);
  const left = crop.cx - crop.halfX;
  const top = crop.cy - crop.halfY;
  for (let y = 0; y < outputSize; y += 1) {
    const sourceY = (top + ((y + 0.5) / outputSize) * 2 * crop.halfY) * depth.height - 0.5;
    for (let x = 0; x < outputSize; x += 1) {
      const sourceX = (left + ((x + 0.5) / outputSize) * 2 * crop.halfX) * depth.width - 0.5;
      output[y * outputSize + x] = Math.round(sampleByte(depth.data, depth.width, depth.height, sourceX, sourceY));
    }
  }
  return output;
}

export function transformLandmarksAndFit(rawLandmarks, depth, crop) {
  invariant(rawLandmarks.length === 478, "landmark count must be 478");
  const transformed = rawLandmarks.map((landmark) => ({
    x: (landmark.x - (crop.cx - crop.halfX)) / (2 * crop.halfX),
    y: (landmark.y - (crop.cy - crop.halfY)) / (2 * crop.halfY),
    z: landmark.z,
  }));
  const samples = rawLandmarks.map((landmark) => ({
    depth: sampleByte(
      depth.data,
      depth.width,
      depth.height,
      landmark.x * depth.width - 0.5,
      landmark.y * depth.height - 0.5,
    ),
    z: landmark.z,
  }));
  const meanDepth = samples.reduce((sum, sample) => sum + sample.depth, 0) / samples.length;
  const meanZ = samples.reduce((sum, sample) => sum + sample.z, 0) / samples.length;
  let covariance = 0;
  let depthVariance = 0;
  let zVariance = 0;
  for (const sample of samples) {
    const depthDelta = sample.depth - meanDepth;
    const zDelta = sample.z - meanZ;
    covariance += depthDelta * zDelta;
    depthVariance += depthDelta * depthDelta;
    zVariance += zDelta * zDelta;
  }
  invariant(depthVariance > 0 && zVariance > 0, "depth/landmark fit is degenerate");
  const a = covariance / depthVariance;
  const b = meanZ - a * meanDepth;
  const correlation = covariance / Math.sqrt(depthVariance * zVariance);
  invariant(Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(correlation), "depth/landmark fit is not finite");
  return { landmarks: transformed, depthFit: { a, b }, correlation };
}

export function pointBounds(...sets) {
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const points of sets) {
    for (let index = 0; index < points.u.length; index += 1) {
      minU = Math.min(minU, points.u[index]);
      maxU = Math.max(maxU, points.u[index]);
      minV = Math.min(minV, points.v[index]);
      maxV = Math.max(maxV, points.v[index]);
    }
  }
  return { minU, maxU, minV, maxV };
}

export function byteBounds(bytes) {
  let min = 255;
  let max = 0;
  for (const value of bytes) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return { min, max };
}

export async function publishFaceAsset(outputDirectory, binary, manifestBase) {
  const absoluteOutput = resolve(outputDirectory);
  await mkdir(absoluteOutput, { recursive: true });
  const digest = sha256(binary);
  const file = `ava-face.${digest.slice(0, 8)}.bin`;
  const manifest = {
    ...manifestBase,
    file,
    sha256: digest,
    bytes: binary.length,
  };
  validateFaceManifest(manifest, binary);
  const nonce = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const binaryTemporary = join(absoluteOutput, `.${file}.${nonce}.tmp`);
  const manifestTemporary = join(absoluteOutput, `.manifest.${nonce}.tmp`);
  const binaryPath = join(absoluteOutput, file);
  const manifestPath = join(absoluteOutput, "manifest.json");
  try {
    await writeFile(binaryTemporary, binary, { flag: "wx" });
    await writeFile(manifestTemporary, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
    validateFaceManifest(manifest, await readFile(binaryTemporary));
    await rename(binaryTemporary, binaryPath);
    await rename(manifestTemporary, manifestPath);
    const files = await readdir(absoluteOutput);
    await Promise.all(files
      .filter((candidate) => /^ava-face\.[a-f0-9]{8}\.bin$/.test(candidate) && candidate !== file)
      .map((candidate) => rm(join(absoluteOutput, candidate), { force: true })));
  } catch (error) {
    await rm(binaryTemporary, { force: true });
    await rm(manifestTemporary, { force: true });
    throw error;
  }
  const published = JSON.parse(await readFile(manifestPath, "utf8"));
  validateFaceManifest(published, await readFile(join(absoluteOutput, published.file)));
  return { manifest: published, binaryPath, manifestPath };
}

export function assertPrivateInputBoundary(inputPath, outputDirectory) {
  const input = resolve(inputPath).toLowerCase();
  const output = resolve(outputDirectory).toLowerCase();
  invariant(input !== output && !input.startsWith(`${output}\\`) && !input.startsWith(`${output}/`), "private input cannot live in the public output directory");
  invariant(!/^ava-face\.[a-f0-9]{8}\.bin$/.test(basename(input)), "a derived asset cannot be used as the private source");
}
