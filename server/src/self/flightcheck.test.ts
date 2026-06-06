import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flightcheck } from "./flightcheck.js";

// Builds a fixture worktree under the OS temp dir. By default it is fully
// populated (every check should pass); `omit` drops pieces so individual
// failures can be asserted.
function makeFixture(omit: { sw?: boolean; swActivate?: boolean; asset?: boolean; serverDist?: boolean; webDist?: boolean } = {}): string {
  const root = mkdtempSync(join(tmpdir(), "ava-fc-"));
  if (!omit.webDist) {
    mkdirSync(join(root, "web", "dist", "assets"), { recursive: true });
    writeFileSync(join(root, "web", "dist", "index.html"), "<!doctype html>");
    if (!omit.asset) writeFileSync(join(root, "web", "dist", "assets", "index-abc123.js"), "console.log(1)");
    if (!omit.sw) {
      const sw = omit.swActivate ? "self.onfetch = () => {}" : "self.skipWaiting(); clients.claim();";
      writeFileSync(join(root, "web", "dist", "sw.js"), sw);
    }
  }
  if (!omit.serverDist) {
    mkdirSync(join(root, "server", "dist"), { recursive: true });
    writeFileSync(join(root, "server", "dist", "index.js"), "// built");
  }
  return root;
}

describe("flightcheck", () => {
  const dirs: string[] = [];
  const fixture = (omit?: Parameters<typeof makeFixture>[0]) => { const d = makeFixture(omit); dirs.push(d); return d; };
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

  it("passes when the worktree is fully populated", async () => {
    const r = await flightcheck({ cwd: fixture() });
    expect(r.ok).toBe(true);
    expect(r.checks.every((c) => c.ok)).toBe(true);
    expect(r.report).toContain("[PASS]");
    expect(r.report).not.toContain("[FAIL]");
  });

  it("fails when sw.js lacks skipWaiting/clients (the stale-bundle regression)", async () => {
    const r = await flightcheck({ cwd: fixture({ swActivate: true }) });
    expect(r.ok).toBe(false);
    const sw = r.checks.find((c) => c.name.includes("service worker"));
    expect(sw?.ok).toBe(false);
    expect(r.report).toContain("[FAIL]");
  });

  it("fails when the web dist is missing entirely", async () => {
    const r = await flightcheck({ cwd: fixture({ webDist: true }) });
    expect(r.ok).toBe(false);
  });

  it("fails when the server build is missing", async () => {
    const r = await flightcheck({ cwd: fixture({ serverDist: true }) });
    expect(r.ok).toBe(false);
    const sv = r.checks.find((c) => c.name.includes("server build"));
    expect(sv?.ok).toBe(false);
  });

  it("fails when no hashed index-*.js asset is present", async () => {
    const r = await flightcheck({ cwd: fixture({ asset: true }) });
    expect(r.ok).toBe(false);
    const a = r.checks.find((c) => c.name.includes("hashed"));
    expect(a?.ok).toBe(false);
  });

  it("fails when sw.js is absent", async () => {
    const r = await flightcheck({ cwd: fixture({ sw: true }) });
    expect(r.ok).toBe(false);
    const sw = r.checks.find((c) => c.name.includes("service worker"));
    expect(sw?.ok).toBe(false);
  });
});
