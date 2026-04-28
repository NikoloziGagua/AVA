import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { Db } from "../state/db.js";
import { upsertSubscription, deleteSubscription } from "../state/push.js";

const SubBody = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  deviceLabel: z.string().nullable().optional(),
});

const DelBody = z.object({ endpoint: z.string().url() });

export type PushCfg = { vapidPublicKey: string | null };

export function pushRoutes(db: Db, auth: RequestHandler, cfg: PushCfg): Router {
  const r = Router();

  r.get("/vapid-public", auth, (_req, res) => {
    if (!cfg.vapidPublicKey) {
      res.status(503).json({ error: "vapid_not_configured" });
      return;
    }
    res.json({ key: cfg.vapidPublicKey });
  });

  r.post("/subscribe", auth, (req, res) => {
    const parsed = SubBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "bad_request", details: parsed.error.flatten() });
      return;
    }
    upsertSubscription(db, {
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      deviceLabel: parsed.data.deviceLabel ?? null,
      deviceTokenId: null,
    });
    res.json({ ok: true });
  });

  r.delete("/subscribe", auth, (req, res) => {
    const parsed = DelBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "bad_request" });
      return;
    }
    deleteSubscription(db, parsed.data.endpoint);
    res.json({ ok: true });
  });

  return r;
}
