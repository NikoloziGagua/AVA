import type { RequestHandler } from "express";
import { validateToken } from "./tokens.js";
import type { Db } from "../state/db.js";

declare global {
  namespace Express {
    interface Request {
      deviceId?: string;
    }
  }
}

export function requireToken(db: Db): RequestHandler {
  return (req, res, next) => {
    const header = req.headers.authorization ?? "";
    const m = /^Bearer\s+(.+)$/.exec(header);
    const queryToken = typeof req.query.t === "string" ? req.query.t : null;
    const presented = m?.[1] ?? queryToken;
    if (!presented) {
      res.status(401).json({ error: "missing_token" });
      return;
    }
    const id = validateToken(db, presented);
    if (!id) {
      res.status(401).json({ error: "invalid_token" });
      return;
    }
    req.deviceId = id;
    next();
  };
}
