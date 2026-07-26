import { Router } from "express";
import type { ActiveRuns } from "../orchestrator/active-runs.js";
import type { Db } from "../state/db.js";
import { readMemoryView } from "../memory/file-view.js";

export function statusRoutes(opts: {
  db: Db;
  runs: ActiveRuns;
  startedAt: number;
  provider: string | null;
  memoryDir: string;
  bindAddr: string;
  port: number;
}): Router {
  const r = Router();
  r.get("/_status", (_req, res) => {
    const sessionCount = (
      opts.db
        .prepare("SELECT COUNT(*) AS c FROM sessions WHERE status = 'active'")
        .get() as { c: number }
    ).c;
    let preferences = 0;
    let observations = 0;
    let projects = 0;
    try {
      const memory = readMemoryView(opts.memoryDir);
      preferences = memory.preferences.lines.length;
      observations = memory.observations.lines.length;
      projects = memory.projects.length;
    } catch {
      // Status must still render when the memory store itself is the failure.
    }
    const ready = opts.provider !== null;
    const provider = opts.provider ?? "not configured — chat is disabled";
    res.type("html").send(`<!doctype html><html><body>
<h1>Ava Status</h1>
<p><strong>Ready:</strong> ${ready ? "yes" : "no"}</p>
<p><strong>LLM provider:</strong> ${escapeHtml(provider)}</p>
<p><strong>Listening:</strong> ${escapeHtml(opts.bindAddr)}:${opts.port}</p>
<p>Uptime: ${Math.floor((Date.now() - opts.startedAt) / 1000)}s</p>
<p>Active sessions: ${sessionCount}</p>
<p>Memory: ${preferences} preferences, ${observations} observations, ${projects} projects</p>
</body></html>`);
  });
  return r;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]!);
}
