import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { pipeline, env } from "@huggingface/transformers";
import sharp from "sharp";
import { chromium } from "playwright";
import { DEPTH_ANYTHING, MEDIAPIPE, MODEL_CACHE_ROOT, depthModelDirectory } from "./model-config.mjs";

const require = createRequire(import.meta.url);
const visionPackage = dirname(require.resolve("@mediapipe/tasks-vision"));

function invariant(condition, message) {
  if (!condition) throw new Error(`face model boundary failed: ${message}`);
}

async function fileSha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function verifyPinnedFile(path, expectedBytes, expectedHash, label) {
  const metadata = await stat(path).catch(() => null);
  invariant(metadata?.isFile(), `${label} is missing at ${path}`);
  if (expectedBytes !== undefined) invariant(metadata.size === expectedBytes, `${label} byte count does not match its pin`);
  invariant(await fileSha256(path) === expectedHash, `${label} SHA-256 does not match its pin`);
}

export async function verifyFaceModelCache() {
  await verifyPinnedFile(MEDIAPIPE.path, 3_758_596, MEDIAPIPE.sha256, MEDIAPIPE.name);
  const root = depthModelDirectory();
  for (const file of DEPTH_ANYTHING.files) {
    await verifyPinnedFile(join(root, file.relative), file.bytes, file.sha256, `${DEPTH_ANYTHING.name} ${file.relative}`);
  }
}

async function downloadAtomic(url, path) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.download-${process.pid}-${Date.now()}`;
  const response = await fetch(url, { redirect: "follow" });
  invariant(response.ok, `download ${url} returned HTTP ${response.status}`);
  await writeFile(temporary, Buffer.from(await response.arrayBuffer()), { flag: "wx" });
  await rename(temporary, path).catch(async (error) => {
    await rm(temporary, { force: true });
    throw error;
  });
}

export async function provisionFaceModelCache() {
  await mkdir(MODEL_CACHE_ROOT, { recursive: true });
  const mediaPipeState = await stat(MEDIAPIPE.path).catch(() => null);
  if (!mediaPipeState?.isFile()) await downloadAtomic(MEDIAPIPE.url, MEDIAPIPE.path);
  await verifyPinnedFile(MEDIAPIPE.path, 3_758_596, MEDIAPIPE.sha256, MEDIAPIPE.name);

  env.cacheDir = DEPTH_ANYTHING.cacheDirectory;
  env.allowRemoteModels = true;
  env.allowLocalModels = true;
  const estimator = await pipeline("depth-estimation", DEPTH_ANYTHING.repository, {
    revision: DEPTH_ANYTHING.revision,
    dtype: "fp32",
  });
  await estimator.dispose?.();
  await verifyFaceModelCache();
}

function contentType(path) {
  switch (extname(path)) {
    case ".mjs": return "text/javascript; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".wasm": return "application/wasm";
    case ".task": return "application/octet-stream";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    default: return "application/octet-stream";
  }
}

function landmarkHtml() {
  return `<!doctype html><html><body><img id="portrait" src="/portrait"><script type="module">
import { FaceLandmarker, FilesetResolver } from "/vision_bundle.mjs";
try {
  const files = await FilesetResolver.forVisionTasks("/wasm");
  const detector = await FaceLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: "/face_landmarker.task" },
    runningMode: "IMAGE",
    numFaces: 1,
  });
  const image = document.getElementById("portrait");
  await image.decode();
  const result = detector.detect(image);
  window.__AVA_RESULT__ = {
    width: image.naturalWidth,
    height: image.naturalHeight,
    landmarks: result.faceLandmarks?.[0] ?? [],
  };
  detector.close();
} catch (error) {
  window.__AVA_RESULT__ = { error: String(error?.stack || error) };
}
</script></body></html>`;
}

async function serveFile(response, path) {
  try {
    const bytes = await readFile(path);
    response.writeHead(200, { "content-type": contentType(path), "cache-control": "no-store" });
    response.end(bytes);
  } catch {
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found");
  }
}

export async function extractFaceLandmarks(inputPath) {
  await verifyFaceModelCache();
  const absoluteInput = resolve(inputPath);
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end(landmarkHtml());
      return;
    }
    if (url.pathname === "/portrait") return void serveFile(response, absoluteInput);
    if (url.pathname === "/vision_bundle.mjs") return void serveFile(response, join(visionPackage, "vision_bundle.mjs"));
    if (url.pathname === "/face_landmarker.task") return void serveFile(response, MEDIAPIPE.path);
    if (url.pathname.startsWith("/wasm/")) {
      const file = url.pathname.slice("/wasm/".length);
      if (!/^[a-z0-9_.-]+$/i.test(file)) {
        response.writeHead(400).end();
        return;
      }
      return void serveFile(response, join(visionPackage, "wasm", file));
    }
    response.writeHead(404).end();
  });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  invariant(address && typeof address === "object", "local landmark server did not bind");
  let browser;
  try {
    browser = await chromium.launch({ channel: "msedge", headless: true });
    const context = await browser.newContext();
    const origin = `http://127.0.0.1:${address.port}`;
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === origin || url.protocol === "data:" || url.protocol === "blob:") await route.continue();
      else await route.abort("blockedbyclient");
    });
    const page = await context.newPage();
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => Boolean(window.__AVA_RESULT__), null, { timeout: 90_000 });
    const result = await page.evaluate(() => window.__AVA_RESULT__);
    invariant(!result.error, `MediaPipe returned ${result.error}`);
    invariant(result.landmarks.length === 478, `MediaPipe returned ${result.landmarks.length} landmarks, expected 478`);
    return result;
  } finally {
    await browser?.close();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

export async function extractDepth(inputPath) {
  await verifyFaceModelCache();
  env.cacheDir = DEPTH_ANYTHING.cacheDirectory;
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  const estimator = await pipeline("depth-estimation", DEPTH_ANYTHING.repository, {
    revision: DEPTH_ANYTHING.revision,
    dtype: "fp32",
    local_files_only: true,
  });
  try {
    const result = await estimator(resolve(inputPath));
    invariant(result?.depth?.channels === 1, "Depth Anything returned a non-grayscale image");
    invariant(result.depth.data instanceof Uint8Array, "Depth Anything returned unexpected depth storage");
    return {
      width: result.depth.width,
      height: result.depth.height,
      data: new Uint8Array(result.depth.data),
    };
  } finally {
    await estimator.dispose?.();
  }
}

export async function extractCropLuminance(inputPath, crop, size) {
  const image = sharp(resolve(inputPath), { failOn: "error" });
  const metadata = await image.metadata();
  invariant(metadata.width && metadata.height, "source dimensions are unavailable");
  const left = Math.max(0, Math.round((crop.cx - crop.halfX) * metadata.width));
  const top = Math.max(0, Math.round((crop.cy - crop.halfY) * metadata.height));
  const right = Math.min(metadata.width, Math.round((crop.cx + crop.halfX) * metadata.width));
  const bottom = Math.min(metadata.height, Math.round((crop.cy + crop.halfY) * metadata.height));
  invariant(right > left && bottom > top, "crop has no source pixels");
  const { data, info } = await sharp(resolve(inputPath), { failOn: "error" })
    .extract({ left, top, width: right - left, height: bottom - top })
    .resize(size, size, { fit: "fill", kernel: sharp.kernel.lanczos3 })
    .removeAlpha()
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  invariant(info.width === size && info.height === size && info.channels === 1, "luminance raster has unexpected dimensions");
  return { width: metadata.width, height: metadata.height, data: new Uint8Array(data) };
}
