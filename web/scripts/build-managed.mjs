/**
 * Production build fallback for managed Windows runners that block esbuild's
 * child process. The normal Vite build remains canonical; this path finishes
 * the direct esbuild CLI output with PostCSS and Workbox in-process.
 */
import { copyFile, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import { injectManifest } from "workbox-build";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
const assets = resolve(dist, "assets");
await mkdir(assets, { recursive: true });

// The fallback build must be independently installable. Do not rely on a
// partially completed Vite build having copied public assets first.
await cp(resolve(root, "public", "fonts"), resolve(dist, "fonts"), { recursive: true, force: true });
await cp(resolve(root, "public", "face"), resolve(dist, "face"), { recursive: true, force: true });
await copyFile(resolve(root, "public", "icon-192.png"), resolve(dist, "icon-192.png"));
await copyFile(resolve(root, "public", "icon-512.png"), resolve(dist, "icon-512.png"));
await writeFile(resolve(dist, "manifest.webmanifest"), JSON.stringify({
  name: "Ava",
  short_name: "Ava",
  start_url: "/",
  display: "standalone",
  background_color: "#050506",
  theme_color: "#050506",
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
  ],
}));

const sourceCss = await readFile(resolve(root, "src", "theme.css"), "utf8");
const css = await postcss([tailwindcss()]).process(sourceCss, {
  from: resolve(root, "src", "theme.css"),
  to: resolve(assets, "index-managed.css"),
});
await writeFile(resolve(assets, "index-managed.css"), css.css);

// The managed build uses stable asset names. Force a service-worker update
// check on every app load and reload once when an already-controlled client
// receives a new worker; otherwise Chrome may keep yesterday's Explorer bundle
// even though the server has been rebuilt.
await writeFile(resolve(dist, "registerSW.js"), `if ("serviceWorker" in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController && !reloading) {
      reloading = true;
      window.location.reload();
    }
  });
  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((registration) => registration.update());
  });
}
`);

await writeFile(resolve(dist, "index.html"), `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#050506" />
    <title>Ava</title>
    <link rel="icon" href="/icon-192.png" />
    <script type="module" crossorigin src="/assets/index-managed.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-managed.css" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <script id="vite-plugin-pwa:register-sw" src="/registerSW.js"></script>
  </head>
  <body class="bg-neutral-950 text-neutral-100">
    <div id="root"></div>
  </body>
</html>
`);

const workerSource = resolve(dist, "sw-managed-source.js");
await injectManifest({
  swSrc: workerSource,
  swDest: resolve(dist, "sw.js"),
  maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
  globDirectory: dist,
  globPatterns: [
    "index.html",
    "manifest.webmanifest",
    "registerSW.js",
    "icon-*.png",
    "assets/index-managed.js",
    "assets/index-managed.css",
    "fonts/*.woff2",
    "face/*.bin",
    "face/manifest.json",
  ],
});

const managedWorker = await readFile(resolve(dist, "sw.js"), "utf8");
for (const font of ["fonts/Geist-Variable.woff2", "fonts/GeistMono-Variable.woff2"]) {
  if (!managedWorker.includes(font)) throw new Error(`managed offline precache is missing ${font}`);
}
const managedFaceManifest = JSON.parse(await readFile(resolve(dist, "face", "manifest.json"), "utf8"));
for (const faceAsset of ["face/manifest.json", `face/${managedFaceManifest.file}`]) {
  if (!managedWorker.includes(faceAsset)) throw new Error(`managed offline precache is missing ${faceAsset}`);
}

console.log("managed production bundle written to web/dist");
