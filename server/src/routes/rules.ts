import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import type { Db } from "../state/db.js";
import { createRule, listRules, updateRule, deleteRule, getRule } from "../state/rules.js";
import { parseRule } from "../policy/rule-parser.js";

const PostBody = z.object({ source: z.string().min(1).max(2000) });
const PatchBody = z.object({ enabled: z.boolean() });

export type RulesDeps = { anthropic: Anthropic | null };

export function rulesRoutes(db: Db, auth: RequestHandler, deps: RulesDeps): Router {
  const r = Router();

  r.get("/", auth, (_req, res) => {
    res.json({ rules: listRules(db) });
  });

  r.post("/", auth, (req, res) => {
    const parsed = PostBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "bad_request" });
      return;
    }
    const rule = createRule(db, { source: parsed.data.source, status: "pending" });
    if (deps.anthropic) {
      const client = deps.anthropic;
      void (async () => {
        const r = await parseRule({ client, source: parsed.data.source });
        if (r.ok) {
          updateRule(db, rule.id, { parsed: JSON.stringify(r.parsed), status: "active" });
        } else {
          updateRule(db, rule.id, { status: "failed" });
        }
      })();
    }
    res.json({ rule });
  });

  r.patch("/:id", auth, (req, res) => {
    const id = req.params.id;
    if (typeof id !== "string") {
      res.status(400).json({ error: "bad_request" });
      return;
    }
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "bad_request" });
      return;
    }
    if (!getRule(db, id)) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    updateRule(db, id, { enabled: parsed.data.enabled });
    res.json({ ok: true });
  });

  r.delete("/:id", auth, (req, res) => {
    const id = req.params.id;
    if (typeof id !== "string") {
      res.status(400).json({ error: "bad_request" });
      return;
    }
    deleteRule(db, id);
    res.json({ ok: true });
  });

  return r;
}
