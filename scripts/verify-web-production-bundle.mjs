import { readdir, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  INITIAL_EAGER_JAVASCRIPT_LIMIT_BYTES,
  INITIAL_EAGER_JAVASCRIPT_LIMIT_FILES,
  PRODUCTION_CHUNK_SIZE_LIMIT_BYTES,
  REQUIRED_DEFERRED_CHUNKS,
  REQUIRED_PRODUCTION_CHUNKS,
  productionChunkForModule,
} from "./web-chunk-policy.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const webDist = join(repoRoot, "web", "dist");
const assetsDir = join(webDist, "assets");

function assert(condition, message) {
  if (!condition) throw new Error(`web production bundle verification failed: ${message}`);
}

const assignmentChecks = [
  ["C:/repo/node_modules/three/build/three.core.js", "vendor-three-core"],
  ["C:/repo/node_modules/three/build/three.module.js", "vendor-three-renderer"],
  ["C:/repo/node_modules/three/examples/jsm/postprocessing/EffectComposer.js", "vendor-three-effects"],
  ["C:/repo/node_modules/gsap/Flip.js", "vendor-animation"],
  ["C:/repo/node_modules/@xyflow/react/dist/esm/index.js", "vendor-diagrams"],
  ["C:/repo/node_modules/react-markdown/index.js", "vendor-markdown"],
  ["C:/repo/node_modules/react-dom/client.js", "vendor-react"],
  ["C:/repo/node_modules/lucide-react/dist/cjs/lucide-react.js", "vendor-core"],
  ["C:/repo/web/src/App.tsx", undefined],
];
for (const [moduleId, expected] of assignmentChecks) {
  assert(
    productionChunkForModule(moduleId) === expected,
    `${moduleId} must resolve to ${expected ?? "the application entry"}`,
  );
}

const files = await readdir(assetsDir);
const javascript = files.filter((name) => name.endsWith(".js")).sort();
assert(javascript.length > 1, "the canonical build must emit more than one JavaScript chunk");

const measured = [];
for (const name of javascript) {
  const size = (await stat(join(assetsDir, name))).size;
  measured.push({ name, size });
  assert(
    size <= PRODUCTION_CHUNK_SIZE_LIMIT_BYTES,
    `${name} is ${size} bytes, above the ${PRODUCTION_CHUNK_SIZE_LIMIT_BYTES}-byte budget`,
  );
}

for (const required of REQUIRED_PRODUCTION_CHUNKS) {
  assert(
    javascript.some((name) => name.startsWith(`${required}-`)),
    `required measured dependency chunk ${required} was not emitted`,
  );
}
assert(
  javascript.some((name) => name.startsWith("vendor-core-")),
  "the residual dependency chunk vendor-core was not emitted",
);

const indexHtml = await readFile(join(webDist, "index.html"), "utf8");
const serviceWorker = await readFile(join(webDist, "sw.js"), "utf8");
const manifest = JSON.parse(await readFile(join(webDist, "manifest.webmanifest"), "utf8"));
assert(manifest.background_color === "#050506", "PWA background must match the default Ink canvas");
assert(manifest.theme_color === "#050506", "PWA theme must match the default Ink canvas");
for (const font of ["Geist-Variable.woff2", "GeistMono-Variable.woff2"]) {
  const path = join(webDist, "fonts", font);
  assert((await stat(path)).size > 1_000, `${font} must be emitted as a real local font asset`);
  assert(serviceWorker.includes(`fonts/${font}`), `${font} is absent from the offline service-worker precache`);
}
const faceManifest = JSON.parse(await readFile(join(webDist, "face", "manifest.json"), "utf8"));
assert(faceManifest.schema === 1, "face manifest schema must be 1");
assert(
  /^ava-face\.[a-f0-9]{8}\.bin$/.test(faceManifest.file),
  "face manifest must reference a content-addressed binary",
);
const faceBinary = await readFile(join(webDist, "face", faceManifest.file));
const faceSha256 = createHash("sha256").update(faceBinary).digest("hex");
assert(faceManifest.sha256 === faceSha256, "face manifest SHA-256 must match its emitted binary");
assert(faceManifest.file === `ava-face.${faceSha256.slice(0, 8)}.bin`, "face file suffix must match its SHA-256");
assert(faceManifest.bytes === faceBinary.length, "face manifest byte count must match its emitted binary");
for (const faceAsset of ["face/manifest.json", `face/${faceManifest.file}`]) {
  assert(serviceWorker.includes(faceAsset), `${faceAsset} is absent from the offline service-worker precache`);
}
const eagerNames = new Set(
  [...indexHtml.matchAll(/(?:src|href)="\/assets\/([^"?]+\.js)(?:\?[^"?]*)?"/g)]
    .map((match) => match[1]),
);
assert(eagerNames.size > 0, "index.html must reference an executable application entry");
assert(
  eagerNames.size <= INITIAL_EAGER_JAVASCRIPT_LIMIT_FILES,
  `initial shell references ${eagerNames.size} JavaScript artifacts, above the ` +
    `${INITIAL_EAGER_JAVASCRIPT_LIMIT_FILES}-artifact budget`,
);
const eager = measured.filter(({ name }) => eagerNames.has(name));
assert(
  eager.length === eagerNames.size,
  "every eager JavaScript reference in index.html must resolve to an emitted artifact",
);
const eagerBytes = eager.reduce((total, { size }) => total + size, 0);
assert(
  eagerBytes <= INITIAL_EAGER_JAVASCRIPT_LIMIT_BYTES,
  `initial shell references ${eagerBytes} JavaScript bytes, above the ` +
    `${INITIAL_EAGER_JAVASCRIPT_LIMIT_BYTES}-byte budget`,
);

for (const deferred of REQUIRED_DEFERRED_CHUNKS) {
  const artifact = measured.find(({ name }) => name.startsWith(`${deferred}-`));
  assert(artifact, `required deferred artifact ${deferred} was not emitted`);
  assert(!eagerNames.has(artifact.name), `${artifact.name} must not be eager in index.html`);
}

for (const { name } of measured) {
  assert(
    indexHtml.includes(name) || serviceWorker.includes(name),
    `${name} is neither referenced by the application shell nor precached`,
  );
  assert(serviceWorker.includes(name), `${name} is absent from the offline service-worker precache`);
}

console.log(
  `web production bundle verified: ${eager.length}/${INITIAL_EAGER_JAVASCRIPT_LIMIT_FILES} eager JS chunks / ` +
  `${eagerBytes}/${INITIAL_EAGER_JAVASCRIPT_LIMIT_BYTES} bytes, ` +
  `${measured.length} installed-offline JS chunks / ` +
  `${measured.reduce((total, { size }) => total + size, 0)} bytes, ` +
  `largest ${Math.max(...measured.map(({ size }) => size))} bytes, ` +
  `all <= ${PRODUCTION_CHUNK_SIZE_LIMIT_BYTES} bytes and precached offline`,
);
