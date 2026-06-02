import { describe, it, expect } from "vitest";
import { buildRunner } from "./verify-runner.js";

describe("buildRunner", () => {
  it("resolves code 0 and captures stdout for a successful command", async () => {
    const run = buildRunner();
    const r = await run("node --version", process.cwd());
    expect(r.code).toBe(0);
    expect(r.output.toLowerCase()).toContain("v"); // node prints e.g. v24.x.x
  });

  it("resolves the real nonzero exit code for a failing command", async () => {
    const run = buildRunner();
    const r = await run('node -e "process.exit(3)"', process.cwd());
    expect(r.code).toBe(3);
  });
});
