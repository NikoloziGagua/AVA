import { Router, type RequestHandler } from "express";
import { listPlaybooks } from "../playbooks/store.js";
import { rmSync } from "node:fs";
import { join } from "node:path";

export type PlaybooksRoutesDeps = { memoryDir: string };

/**
 * Read surface for Ava's learned workflows. Playbooks are how Ava gets faster
 * at repeated tasks (capture → distill → recall); until this route they were
 * invisible except by reading the .md files on disk. GET lists everything with
 * the optimization metrics (uses, succ/fail, avg_secs, version, lessons) so
 * Sir can see WHAT Ava has learned and whether it's actually working.
 */
export function playbooksRoutes(auth: RequestHandler, deps: PlaybooksRoutesDeps): Router {
  const r = Router();

  r.get("/", auth, (_req, res) => {
    const books = listPlaybooks(deps.memoryDir)
      .sort((a, b) => b.uses - a.uses || b.last_used.localeCompare(a.last_used));
    res.json({ playbooks: books });
  });

  r.delete("/:slug", auth, (req, res) => {
    // Slug charset is produced by slugify() (a-z0-9-); reject anything else so
    // the path join can't escape the playbooks dir.
    const slug = String(req.params.slug);
    if (!/^[a-z0-9-]{1,64}$/.test(slug)) {
      res.status(400).json({ error: "bad_slug" });
      return;
    }
    rmSync(join(deps.memoryDir, "playbooks", `${slug}.md`), { force: true });
    res.json({ deleted: slug });
  });

  return r;
}
