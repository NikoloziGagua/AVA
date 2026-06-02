import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { Db } from "../state/db.js";
import { createIntent, listIntents, getIntent, updateIntent } from "../self/intents.js";

const Body = z.object({ goal: z.string().min(1).max(2000) });

export type SelfRouteDeps = { startImprovement: (id: string) => void; revert: (id: string) => void };

export function selfRoutes(db: Db, auth: RequestHandler, deps: SelfRouteDeps): Router {
  const r = Router();
  r.post("/improve", auth, (req, res) => {
    const p = Body.safeParse(req.body);
    if (!p.success) { res.status(400).json({ error: "bad_request" }); return; }
    const id = createIntent(db, { trigger: "explicit", goal: p.data.goal });
    deps.startImprovement(id);
    res.json({ id });
  });
  r.get("/", auth, (_req, res) => { res.json({ intents: listIntents(db) }); });
  r.post("/:id/revert", auth, (req, res) => {
    const id = req.params.id;
    if (typeof id !== "string") { res.status(400).json({ error: "bad_request" }); return; }
    const row = getIntent(db, id);
    if (!row?.last_known_good) { res.status(404).json({ error: "no_known_good" }); return; }
    deps.revert(row.id);
    updateIntent(db, row.id, { status: "rolled_back", outcome: "manual revert requested" });
    res.json({ ok: true, revertTo: row.last_known_good });
  });
  return r;
}
