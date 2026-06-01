import { describe, it, expect } from "vitest";
import { verify } from "./verify.js";

describe("verify", () => {
  const ok = async () => ({ code: 0, output: "ok" });

  it("passes only when every check AND the boot smoke-test pass", async () => {
    const r = await verify({ cwd: "W", run: ok, bootSmoke: async () => ({ ok: true, log: "healthy" }) });
    expect(r.ok).toBe(true);
  });

  it("fails fast and reports which check failed (build never runs)", async () => {
    const calls: string[] = [];
    const run = async (cmd: string) => { calls.push(cmd); return cmd.includes("test") ? { code: 1, output: "tests failed" } : { code: 0, output: "" }; };
    const r = await verify({ cwd: "W", run, bootSmoke: async () => ({ ok: true, log: "" }) });
    expect(r.ok).toBe(false);
    expect(r.log).toContain("tests failed");
    expect(calls.some((c) => c.includes("build"))).toBe(false); // stopped before build
  });

  it("fails when the boot smoke-test fails even if checks pass", async () => {
    const r = await verify({ cwd: "W", run: ok, bootSmoke: async () => ({ ok: false, log: "auth 401" }) });
    expect(r.ok).toBe(false);
    expect(r.log).toContain("auth 401");
  });
});
