import { Router, type RequestHandler } from "express";
import type { Db } from "../state/db.js";
import { listSessions, listSessionsPage, SessionListError, type SessionScope, getSession, softDeleteSession, setPinned } from "../state/sessions.js";
import { listMessages } from "../state/messages.js";
import { getVisualExplanation } from "../state/visual-explanations.js";

export function sessionsRoutes(db: Db, auth: RequestHandler): Router {
  const r = Router();

  r.get("/", auth, (req, res) => {
    const { scope, limit, cursor } = req.query;
    // Preserve the original unfiltered API for older callers.
    if (scope === undefined && limit === undefined && cursor === undefined) {
      res.json({ sessions: listSessions(db) });
      return;
    }
    if (typeof scope !== "string" || !["human", "automation", "legacy", "all", "inbox"].includes(scope)
      || limit !== undefined && (typeof limit !== "string" || !/^(?:[1-9]\d?|100)$/.test(limit))
      || cursor !== undefined && typeof cursor !== "string") {
      res.status(400).json({ error: "bad_request" });
      return;
    }
    try {
      res.json(listSessionsPage(db, {
        scope: scope as SessionScope,
        ...(limit === undefined ? {} : { limit: Number(limit) }),
        ...(cursor === undefined ? {} : { cursor }),
      }));
    } catch (error) {
      if (!(error instanceof SessionListError)) throw error;
      res.status(error.status).json({ error: error.code });
    }
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
    const messages = listMessages(db, session.id).map((message) => ({
      ...message,
      visualMessages: (message.metadata?.visualMessages ?? [])
        .map((reference) => getVisualExplanation(db, reference.visualMessageId, reference.revision))
        .filter((visual) => visual !== null),
    }));
    res.json({ session, messages });
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
