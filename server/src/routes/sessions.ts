import { Router, type RequestHandler } from "express";
import type { Db } from "../state/db.js";
import { listSessions, getSession, softDeleteSession, setPinned } from "../state/sessions.js";
import { listMessages } from "../state/messages.js";

export function sessionsRoutes(db: Db, auth: RequestHandler): Router {
  const r = Router();

  r.get("/", auth, (_req, res) => {
    res.json({ sessions: listSessions(db) });
  });

  r.get("/:id", auth, (req, res) => {
    const id = req.params.id;
    if (typeof id !== "string") {
      res.status(400).json({ error: "bad_request" });
      return;
    }
    const session = getSession(db, id);
    if (!session) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ session, messages: listMessages(db, session.id) });
  });

  r.patch("/:id", auth, (req, res) => {
    const id = req.params.id;
    if (typeof id !== "string") {
      res.status(400).json({ error: "bad_request" });
      return;
    }
    const pinned = req.body?.pinned;
    if (typeof pinned !== "boolean") {
      res.status(400).json({ error: "bad_request" });
      return;
    }
    const session = getSession(db, id);
    if (!session) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    setPinned(db, id, pinned);
    res.status(204).end();
  });

  r.delete("/:id", auth, (req, res) => {
    const id = req.params.id;
    if (typeof id !== "string") {
      res.status(400).json({ error: "bad_request" });
      return;
    }
    const session = getSession(db, id);
    if (!session) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    softDeleteSession(db, id);
    res.status(204).end();
  });

  return r;
}
