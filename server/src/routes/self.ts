import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { Db } from "../state/db.js";
import { createIntent, listIntents, getIntent, updateIntent } from "../self/intents.js";
import { setImprovementsPaused, improvementsPaused } from "../self/improver.js";

const Body = z.object({ goal: z.string().min(1).max(2000) });
const PauseBody = z.object({ paused: z.boolean() });

export type SelfRouteDeps = {
  startImprovement: (id: string) => void;
  revert: (id: string) => void;
  /** Cancel a running/queued self-improvement. Returns true if one was cancelled. */
  cancel: (id: string) => boolean;
  /** Approve a plan parked at awaiting_approval → it proceeds to implement. */
  approve: (id: string) => boolean;
  /** Reject a plan parked at awaiting_approval → it stops without writing code. */
  reject: (id: string) => boolean;
};

export function selfRoutes(db: Db, auth: RequestHandler, deps: SelfRouteDeps): Router {
  const r = Router();
  r.post("/improve", auth, (req, res) => {
    const p = Body.safeParse(req.body);
    if (!p.success) { res.status(400).json({ error: "bad_request" }); return; }
    if (improvementsPaused()) { res.status(409).json({ error: "paused" }); return; }
    const id = createIntent(db, { trigger: "explicit", goal: p.data.goal });
    deps.startImprovement(id);
    res.json({ id });
  });
  r.get("/", auth, (_req, res) => { res.json({ intents: listIntents(db), paused: improvementsPaused() }); });
  // The Self screen's Pause toggle used to be pure client state — now it
  // actually gates intake (both this API and the self_improve chat tool).
  r.post("/pause", auth, (req, res) => {
    const p = PauseBody.safeParse(req.body);
    if (!p.success) { res.status(400).json({ error: "bad_request" }); return; }
    setImprovementsPaused(p.data.paused);
    res.json({ paused: improvementsPaused() });
  });
  r.post("/:id/cancel", auth, (req, res) => {
    const id = req.params.id;
    if (typeof id !== "string") { res.status(400).json({ error: "bad_request" }); return; }
    const cancelled = deps.cancel(id);
    res.json({ ok: true, cancelled });
  });
  r.post("/:id/approve", auth, (req, res) => {
    const id = req.params.id;
    if (typeof id !== "string") { res.status(400).json({ error: "bad_request" }); return; }
    const approved = deps.approve(id);
    res.json({ ok: true, approved });
  });
  r.post("/:id/reject", auth, (req, res) => {
    const id = req.params.id;
    if (typeof id !== "string") { res.status(400).json({ error: "bad_request" }); return; }
    const rejected = deps.reject(id);
    res.json({ ok: true, rejected });
  });
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
