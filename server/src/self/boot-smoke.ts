import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Boots the built candidate server on a scratch port + temp DATA_DIR, asserts
// /api/health responds, then shuts it down. The candidate's own `npm test` (run
// in verify) covers auth + the secret-scrubber; this probe proves the built
// server actually starts.
export async function bootSmoke(cwd: string): Promise<{ ok: boolean; log: string }> {
  const port = 8000 + Math.floor(Math.random() * 1000);
  const dataDir = mkdtempSync(join(tmpdir(), "ava-smoke-"));
  const child = spawn("node", ["dist/index.js"], {
    cwd: join(cwd, "server"),
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, OPENAI_API_KEY: "" },
    windowsHide: true,
  });
  let log = "";
  child.stdout?.on("data", (d) => (log += d));
  child.stderr?.on("data", (d) => (log += d));
  try {
    const ok = await waitForHealth(port, 15_000);
    return { ok, log: ok ? "healthy" : `no /api/health within timeout\n${log.slice(-2000)}` };
  } finally {
    child.kill();
  }
}

async function waitForHealth(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
