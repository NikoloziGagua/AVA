import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PRODUCTION_CHUNK_SIZE_LIMIT_BYTES,
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
for (const { name } of measured) {
  assert(
    indexHtml.includes(name) || serviceWorker.includes(name),
    `${name} is neither referenced by the application shell nor precached`,
  );
  assert(serviceWorker.includes(name), `${name} is absent from the offline service-worker precache`);
}

console.log(
  `web production bundle verified: ${measured.length} JS chunks, ` +
  `largest ${Math.max(...measured.map(({ size }) => size))} bytes, ` +
  `all <= ${PRODUCTION_CHUNK_SIZE_LIMIT_BYTES} bytes and precached offline`,
);
