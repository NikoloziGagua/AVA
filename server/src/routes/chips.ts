import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { Db } from "../state/db.js";
import {
  createChip,
  deleteChip,
  getChip,
  listChips,
  updateChip,
} from "../state/chip-overrides.js";

const PostBody = z.object({
  label: z.string().min(1).max(40),
  prompt: z.string().min(1).max(2000),
  pinned: z.boolean().optional(),
  position: z.number().int().optional(),
});

const PatchBody = z.object({
  label: z.string().min(1).max(40).optional(),
  prompt: z.string().min(1).max(2000).optional(),
  pinned: z.boolean().optional(),
  position: z.number().int().optional(),
});

export function chipsRoutes(db: Db, auth: RequestHandler): Router {
  const r = Router();

  r.get("/", auth, (req, res) => {
    if (!req.deviceId) {
      res.status(401).json({ error: "missing_device" });
      return;
    }
    res.json({ chips: listChips(db, req.deviceId) });
  });

  r.post("/", auth, (req, res) => {
    if (!req.deviceId) {
      res.status(401).json({ error: "missing_device" });
      return;
    }
    const parsed = PostBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "bad_request", details: parsed.error.flatten() });
      return;
    }
    const chip = createChip(db, req.deviceId, parsed.data);
    res.json({ chip });
  });

  r.patch("/:id", auth, (req, res) => {
    if (!req.deviceId) {
      res.status(401).json({ error: "missing_device" });
      return;
    }
    const id = req.params.id;
    if (typeof id !== "string") {
      res.status(400).json({ error: "bad_request" });
      return;
    }
    const existing = getChip(db, id);
    if (!existing || existing.device_id !== req.deviceId) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "bad_request" });
      return;
    }
    const chip = updateChip(db, id, parsed.data);
    res.json({ chip });
  });

  r.delete("/:id", auth, (req, res) => {
    if (!req.deviceId) {
      res.status(401).json({ error: "missing_device" });
      return;
    }
    const id = req.params.id;
    if (typeof id !== "string") {
      res.status(400).json({ error: "bad_request" });
      return;
    }
    const existing = getChip(db, id);
    if (!existing || existing.device_id !== req.deviceId) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    deleteChip(db, id);
    res.json({ ok: true });
  });

  return r;
}
