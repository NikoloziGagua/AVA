import { Router } from "express";
import type { ActiveRuns } from "../orchestrator/active-runs.js";
import type { Db } from "../state/db.js";

export function statusRoutes(opts: {
  db: Db;
  runs: ActiveRuns;
  startedAt: number;
}): Router {
  const r = Router();
  r.get("/_status", (_req, res) => {
    const sessionCount = (
      opts.db
        .prepare("SELECT COUNT(*) AS c FROM sessions WHERE status = 'active'")
        .get() as { c: number }
    ).c;
    res.type("html").send(`<!doctype html><html><body>
<h1>Ava Status</h1>
<p>Uptime: ${Math.floor((Date.now() - opts.startedAt) / 1000)}s</p>
<p>Active sessions: ${sessionCount}</p>
</body></html>`);
  });
  return r;
}
