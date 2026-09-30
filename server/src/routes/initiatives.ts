import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { Db } from "../state/db.js";
import { getInitiativeSettings, updateInitiativeSettings } from "../initiative/settings.js";
import { inboxSummary, initiativeView, markOpened, setDisposition } from "../initiative/store.js";

const Disposition = z.object({ state: z.enum(["later", "not_useful"]), expectedVersion: z.number().int().positive().safe() }).strict();
export function initiativesRoutes(db: Db, auth: RequestHandler): Router {
  const r = Router();
  r.use(auth);
  r.get("/settings", (_req, res) => { res.json(getInitiativeSettings(db)); });
  r.patch("/settings", (req, res) => {
    const result = updateInitiativeSettings(db, req.body);
    if (typeof result === "string") { res.status(result === "stale_version" ? 409 : 400).json({ error: result }); return; }
    res.json(result);
  });
  r.get("/inbox-summary", (_req, res) => { res.json(inboxSummary(db)); });
  r.get("/:id", (req, res) => {
    const view = initiativeView(db, String(req.params.id));
    if (!view) { res.status(404).json({ error: "initiative_unavailable" }); return; }
    res.json(view);
  });
  r.post("/:id/opened", (req, res) => {
    if (!markOpened(db, String(req.params.id))) { res.status(404).json({ error: "initiative_unavailable" }); return; }
    res.status(204).end();
  });
  r.post("/:id/disposition", (req, res) => {
    const parsed = Disposition.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "bad_request" }); return; }
    const result = setDisposition(db, String(req.params.id), parsed.data.state, parsed.data.expectedVersion);
    if (!result) { res.status(404).json({ error: "initiative_unavailable" }); return; }
    if (!result.ok) { res.status(409).json({ error: "stale_version", disposition: { state: result.disposition.state, version: result.disposition.version } }); return; }
    res.json({ disposition: result.disposition });
  });
  r.use((_error: unknown, _req: import("express").Request, res: import("express").Response, _next: import("express").NextFunction) => {
    res.status(503).json({ error: "initiative_unavailable" });
  });
  return r;
}
