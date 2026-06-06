import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type FlightcheckCheck = { name: string; ok: boolean; detail: string };
export type FlightcheckResult = { ok: boolean; report: string; checks: FlightcheckCheck[] };

// DETERMINISTIC post-verify guard, report-only: file-existence + file-content
// checks against a built worktree. NO model/network calls. Runs AFTER verify (so
// web/dist + server/dist already exist) and NEVER gates the swap in increment 1.
export async function flightcheck(o: { cwd: string }): Promise<FlightcheckResult> {
  const { cwd } = o;
  const checks: FlightcheckCheck[] = [];

  // web bundle present
  const indexHtml = join(cwd, "web", "dist", "index.html");
  checks.push({
    name: "web bundle present",
    ok: existsSync(indexHtml),
    detail: existsSync(indexHtml) ? "web/dist/index.html exists" : "missing web/dist/index.html",
  });

  // service worker self-activates — guards the stale-bundle regression: the SW
  // must call skipWaiting() + clients.claim() so a new bundle takes over at once.
  const swPath = join(cwd, "web", "dist", "sw.js");
  const swText = existsSync(swPath) ? safeRead(swPath) : null;
  const swOk = swText != null && swText.includes("skipWaiting") && swText.includes("clients");
  checks.push({
    name: "service worker self-activates",
    ok: swOk,
    detail: swText == null
      ? "missing web/dist/sw.js"
      : swOk
        ? "sw.js contains skipWaiting + clients"
        : "sw.js missing skipWaiting and/or clients.claim",
  });

  // hashed assets present — at least one index-*.js in web/dist/assets/
  const assetsDir = join(cwd, "web", "dist", "assets");
  const hashed = listAssets(assetsDir).filter((f) => /^index-.*\.js$/.test(f));
  checks.push({
    name: "hashed assets present",
    ok: hashed.length > 0,
    detail: hashed.length > 0 ? `found ${hashed[0]}` : "no index-*.js in web/dist/assets/",
  });

  // server build present
  const serverIndex = join(cwd, "server", "dist", "index.js");
  checks.push({
    name: "server build present",
    ok: existsSync(serverIndex),
    detail: existsSync(serverIndex) ? "server/dist/index.js exists" : "missing server/dist/index.js",
  });

  const ok = checks.every((c) => c.ok);
  const report = checks.map((c) => `${c.ok ? "[PASS]" : "[FAIL]"} ${c.name} — ${c.detail}`).join("\n");
  return { ok, report, checks };
}

function safeRead(p: string): string | null {
  try { return readFileSync(p, "utf8"); } catch { return null; }
}

function listAssets(dir: string): string[] {
  try { return readdirSync(dir); } catch { return []; }
}
