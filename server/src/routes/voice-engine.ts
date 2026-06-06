import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { Db } from "../state/db.js";
import { getVoiceEngine, setVoiceEngine } from "../state/voice-engine-pref.js";

const PostBody = z.object({ engine: z.enum(["openai", "hume"]) });

export function voiceEngineRoutes(db: Db, auth: RequestHandler): Router {
  const r = Router();

  r.get("/", auth, (_req, res) => {
    res.json({ engine: getVoiceEngine(db) });
  });

  r.post("/", auth, (req, res) => {
    const parsed = PostBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "bad_request" });
      return;
    }
    setVoiceEngine(db, parsed.data.engine);
    res.json({ engine: parsed.data.engine });
  });

  return r;
}
