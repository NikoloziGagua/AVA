import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { Db } from "../state/db.js";
import { getReasoningLevel, setReasoningLevel } from "../state/reasoning-pref.js";

const PutBody = z.object({ level: z.enum(["fast", "thorough"]) });

export type ReasoningDeps = { supported: boolean };

export function reasoningRoutes(db: Db, auth: RequestHandler, deps: ReasoningDeps): Router {
  const r = Router();

  r.get("/", auth, (_req, res) => {
    res.json({ level: getReasoningLevel(db), supported: deps.supported });
  });

  r.put("/", auth, (req, res) => {
    const parsed = PutBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "bad_request" });
      return;
    }
    setReasoningLevel(db, parsed.data.level);
    res.json({ level: parsed.data.level });
  });

  return r;
}
