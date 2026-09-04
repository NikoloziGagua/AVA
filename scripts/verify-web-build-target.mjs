import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const expectedTarget = "ES2022";

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(repoRoot, relativePath), "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(`web build target verification failed: ${message}`);
}

const baseConfig = readJson("tsconfig.base.json");
const serverConfig = readJson("server/tsconfig.json");
const webConfig = readJson("web/tsconfig.json");
const webPackage = readJson("web/package.json");

assert(
  baseConfig.compilerOptions?.target === expectedTarget,
  `the shared TypeScript emit target must be ${expectedTarget}`,
);
assert(
  !Object.hasOwn(webConfig.compilerOptions ?? {}, "target"),
  "web/tsconfig.json must inherit the shared target instead of drifting",
);
assert(
  webConfig.compilerOptions?.lib?.includes(expectedTarget),
  `the web standard-library contract must match ${expectedTarget}`,
);
assert(
  !Object.hasOwn(serverConfig.compilerOptions ?? {}, "target") &&
    serverConfig.compilerOptions?.lib?.includes("ES2024"),
  "the server must share ES2022 emit while retaining Node 24's ES2024 API typings",
);

const managedCommand = webPackage.scripts?.["build:managed"] ?? "";
assert(
  webPackage.scripts?.build?.startsWith("npm run verify:build-target &&"),
  "the canonical web build must run this guard before compilation",
);
assert(
  managedCommand.startsWith("npm run verify:build-target &&"),
  "the managed fallback build must run this guard before compilation",
);
const managedTargets = [...managedCommand.matchAll(/--target=([a-z0-9]+)/gi)]
  .map((match) => match[1]?.toUpperCase());
assert(
  managedTargets.length === 2 && managedTargets.every((target) => target === expectedTarget),
  `both managed browser bundles must target ${expectedTarget}`,
);

// vite-plugin-pwa performs a second production build with its own Vite/esbuild
// dependency. Probe that exact resolver, not AVA's newer top-level esbuild, so
// an unsupported target cannot quietly return as dependency layout changes.
const require = createRequire(import.meta.url);
const pwaPackagePath = require.resolve("vite-plugin-pwa/package.json");
const pwaRequire = createRequire(pwaPackagePath);
const workerVitePackagePath = pwaRequire.resolve("vite/package.json");
const workerRequire = createRequire(workerVitePackagePath);
const workerEsbuildPackagePath = workerRequire.resolve("esbuild/package.json");
const workerEsbuildPackage = workerRequire(workerEsbuildPackagePath);
const workerEsbuild = workerRequire(dirname(workerEsbuildPackagePath));

workerEsbuild.transformSync("const targetProbe = async () => 1;", {
  loader: "js",
  target: expectedTarget.toLowerCase(),
});

console.log(
  `web build target verified: ${expectedTarget} ` +
  `(PWA worker Vite ${workerRequire(workerVitePackagePath).version}, ` +
  `esbuild ${workerEsbuildPackage.version})`,
);
