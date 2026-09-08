import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    /**
     * jsdom by default — this workspace is a browser app.
     *
     * Without it every test that renders a component died on
     * "document is not defined", which meant the entire Explorer UI suite
     * (12 tests) plus the voice hook tests were failing rather than covering
     * anything. A test that cannot execute is worse than a missing one: it
     * reads as coverage in the file tree while proving nothing.
     *
     * Pure-logic tests run fine under jsdom; the cost is a little startup
     * time, which is the right trade for having the DOM tests actually run.
     */
    environment: "jsdom",
  },
});
