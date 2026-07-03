import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { Db } from "../state/db.js";
import { createWatch, listWatches, deleteWatch, setWatchEnabled } from "../state/watches.js";

const CreateBody = z.object({
  prompt: z.string().min(1).max(2000),
  interval_minutes: z.number().min(1).max(24 * 60),
  once: z.boolean().optional(),
});
const ToggleBody = z.object({ enabled: z.boolean() });

/** Read/manage surface for standing watches (long-term monitoring). */
export function watchesRoutes(db: Db, auth: RequestHandler): Router {
  const r = Router();
  r.get("/", auth, (_req, res) => { res.json({ watches: listWatches(db) }); });
  r.post("/", auth, (req, res) => {
    const p = CreateBody.safeParse(req.body);
    if (!p.success) { res.status(400).json({ error: "bad_request" }); return; }
    res.json({ watch: createWatch(db, { prompt: p.data.prompt, intervalMinutes: p.data.interval_minutes, once: p.data.once }) });
  });
  r.post("/:id/enabled", auth, (req, res) => {
    const p = ToggleBody.safeParse(req.body);
    if (!p.success || typeof req.params.id !== "string") { res.status(400).json({ error: "bad_request" }); return; }
    setWatchEnabled(db, req.params.id, p.data.enabled);
    res.json({ ok: true });
  });
  r.delete("/:id", auth, (req, res) => {
    const id = req.params.id;
    if (typeof id !== "string") { res.status(400).json({ error: "bad_request" }); return; }
    res.json({ deleted: deleteWatch(db, id) });
  });
  return r;
}
