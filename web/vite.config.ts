import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      manifest: {
        name: "Ava",
        short_name: "Ava",
        start_url: "/",
        display: "standalone",
        background_color: "#0a0a0a",
        theme_color: "#0a0a0a",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      // The realtime voice proxy is a WebSocket upgrade. Vite does NOT forward
      // upgrades unless the entry is marked ws:true, so without this the voice
      // socket hangs on "connecting" and the upgrade never reaches :8787.
      // Must precede the generic "/api" entry so it matches first.
      "/api/voice/realtime": { target: "ws://localhost:8787", ws: true },
      "/api": "http://localhost:8787",
    },
  },
});
