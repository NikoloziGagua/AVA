import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { Db } from "../state/db.js";
import { consumePairingCode } from "../auth/pairing.js";
import { issueToken, listTokens, revokeToken } from "../auth/tokens.js";

const PairBody = z.object({
  code: z.string().min(1),
  label: z.string().min(1).max(50),
});

export function authRoutes(db: Db, auth: RequestHandler): Router {
  const r = Router();

  r.post("/pair", (req, res) => {
    const parsed = PairBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "bad_request", details: parsed.error.flatten() });
      return;
    }
    if (!consumePairingCode(db, parsed.data.code)) {
      res.status(400).json({ error: "invalid_or_expired_code" });
      return;
    }
    const { id, secret } = issueToken(db, { label: parsed.data.label });
    res.json({ token: secret, deviceId: id });
  });

  r.get("/devices", auth, (_req, res) => {
    res.json({ devices: listTokens(db) });
  });

  r.delete("/devices/:id", auth, (req, res) => {
    revokeToken(db, req.params.id!);
    res.status(204).end();
  });

  return r;
}
