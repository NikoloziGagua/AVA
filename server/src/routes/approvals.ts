import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { Db } from "../state/db.js";
import { listPendingForSession, decide, getApproval } from "../state/approvals.js";

const PendingQuery = z.object({ sessionId: z.string().min(1) });

export function approvalsRoutes(db: Db, auth: RequestHandler): Router {
  const r = Router();

  r.get("/pending", auth, (req, res) => {
    const parsed = PendingQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "bad_request" });
      return;
    }
    res.json({ approvals: listPendingForSession(db, parsed.data.sessionId) });
  });

  r.post("/:id/approve", auth, (req, res) => {
    const id = req.params.id;
    if (typeof id !== "string") { res.status(400).json({ error: "bad_request" }); return; }
    const cur = getApproval(db, id);
    if (!cur) { res.status(404).json({ error: "not_found" }); return; }
    const ok = decide(db, id, "approved");
    if (!ok) { res.status(400).json({ error: "already_decided", status: cur.status }); return; }
    res.json({ ok: true, status: "approved" });
  });

  r.post("/:id/deny", auth, (req, res) => {
    const id = req.params.id;
    if (typeof id !== "string") { res.status(400).json({ error: "bad_request" }); return; }
    const cur = getApproval(db, id);
    if (!cur) { res.status(404).json({ error: "not_found" }); return; }
    const ok = decide(db, id, "denied");
    if (!ok) { res.status(400).json({ error: "already_decided", status: cur.status }); return; }
    res.json({ ok: true, status: "denied" });
  });

  return r;
}
