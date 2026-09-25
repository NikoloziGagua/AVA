import { access, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { encodeFaceAsset } from "./face-asset-format.mjs";
import { generatePointSet, maximumNormalisedHistogramDelta } from "./face-sampling.mjs";
import {
  assertPrivateInputBoundary,
  byteBounds,
  cropDepthRaster,
  pointBounds,
  publishFaceAsset,
  transformLandmarksAndFit,
} from "./face-build-utils.mjs";
import {
  extractCropLuminance,
  extractDepth,
  extractFaceLandmarks,
  verifyFaceModelCache,
} from "./face-models.mjs";
import { MODEL_LICENCES, MODEL_PROVENANCE } from "./model-config.mjs";

const DEFAULT_OUTPUT = fileURLToPath(new URL("../../../web/public/face/", import.meta.url));
const DEFAULT_SEED = 0x41564131;
const CROP = Object.freeze({ cx: 0.484, cy: 0.52, halfX: 0.4, halfY: 0.4 });
const RASTER_SIZE = 512;
const DEPTH_SIZE = 200;
const STIPPLE_COUNT = 60_000;
const GLOW_COUNT = 32_000;
const STIPPLE_ITERATIONS = 6;
const PHONE_PREFIX_COUNT = 42_000;
const PREFIX_HISTOGRAM_TOLERANCE = 0.0025;

function invariant(condition, message) {
  if (!condition) throw new Error(`face asset build failed: ${message}`);
}

function parseArguments(argv) {
  const options = { out: DEFAULT_OUTPUT, seed: DEFAULT_SEED };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--input") options.input = argv[++index];
    else if (argument === "--out") options.out = argv[++index];
    else if (argument === "--seed") options.seed = Number(argv[++index]);
    else throw new Error(`unknown argument: ${argument}`);
  }
  invariant(typeof options.input === "string" && options.input.length > 0, "--input <private path> is required");
  invariant(typeof options.out === "string" && options.out.length > 0, "--out must be a directory");
  invariant(Number.isInteger(options.seed) && options.seed >= 0 && options.seed <= 0xffff_ffff, "--seed must be a uint32");
  return { input: resolve(options.input), out: resolve(options.out), seed: options.seed };
}

export async function buildFaceAsset(options) {
  const input = resolve(options.input);
  const out = resolve(options.out ?? DEFAULT_OUTPUT);
  const seed = options.seed ?? DEFAULT_SEED;
  assertPrivateInputBoundary(input, out);
  await access(input);
  invariant((await stat(input)).isFile(), "private input is not a file");
  await verifyFaceModelCache();

  const sourceBefore = await readFile(input);
  const [landmarkResult, depth, luminance] = await Promise.all([
    extractFaceLandmarks(input),
    extractDepth(input),
    extractCropLuminance(input, CROP, RASTER_SIZE),
  ]);
  invariant(landmarkResult.width === luminance.width && landmarkResult.height === luminance.height, "model/source dimensions disagree");
  const stipple = generatePointSet({
    luminance: luminance.data,
    size: RASTER_SIZE,
    count: STIPPLE_COUNT,
    seed,
    mode: "stipple",
    iterations: STIPPLE_ITERATIONS,
  });
  const glow = generatePointSet({
    luminance: luminance.data,
    size: RASTER_SIZE,
    count: GLOW_COUNT,
    seed: (seed ^ 0x9e3779b9) >>> 0,
    mode: "glow",
  });
  const prefixHistogramDelta = maximumNormalisedHistogramDelta(stipple, PHONE_PREFIX_COUNT);
  invariant(
    prefixHistogramDelta <= PREFIX_HISTOGRAM_TOLERANCE,
    `42k prefix histogram delta ${prefixHistogramDelta} exceeds ${PREFIX_HISTOGRAM_TOLERANCE}`,
  );
  const { landmarks, depthFit, correlation } = transformLandmarksAndFit(landmarkResult.landmarks, depth, CROP);
  const depthRaster = cropDepthRaster(depth, CROP, DEPTH_SIZE);
  const binary = encodeFaceAsset({
    stipple,
    glow,
    landmarks,
    depth: depthRaster,
    depthSize: DEPTH_SIZE,
    crop: CROP,
    depthFit,
    seed,
  });
  const sourceAfter = await readFile(input);
  invariant(sourceBefore.equals(sourceAfter), "private source changed during the build");
  const result = await publishFaceAsset(out, binary, {
    schema: 1,
    version: "1.0.0",
    seed,
    counts: {
      stipple: STIPPLE_COUNT,
      glow: GLOW_COUNT,
      landmarks: landmarks.length,
      depthSize: DEPTH_SIZE,
    },
    crop: CROP,
    depthFit,
    correlation,
    pointBounds: pointBounds(stipple, glow),
    depthBounds: byteBounds(depthRaster),
    models: MODEL_PROVENANCE,
    method: {
      stipple: "weighted Voronoi stippling (deterministic Lloyd relaxation)",
      iterations: STIPPLE_ITERATIONS,
      density: "(1 - L)^1.35 + 0.03; L <= 0.07 excluded; bottom fade",
      glowDensity: "smooth(0.07, 0.95, L)^0.85; L <= 0.07 excluded; bottom fade",
      crop: "source-normalised portrait-specific crop; private source study",
      prefixHistogram: {
        prefix: PHONE_PREFIX_COUNT,
        grid: "8x8",
        maximumNormalisedDelta: prefixHistogramDelta,
        tolerance: PREFIX_HISTOGRAM_TOLERANCE,
      },
    },
    licences: MODEL_LICENCES,
    source: "private AI portrait (not committed)",
  });
  return result;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const result = await buildFaceAsset(options);
  console.log(`AVA face asset written: ${result.manifest.file} (${result.manifest.bytes} bytes)`);
  console.log(`source retained privately and unchanged: ${options.input}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
