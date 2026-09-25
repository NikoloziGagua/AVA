import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { Db } from "../state/db.js";
import { getUiPreferences, updateUiPreferences } from "../state/ui-preferences.js";

const PatchBody = z.object({
  expectedVersion: z.number().int().positive(),
  look: z.enum(["ink", "paper", "system"]).optional(),
  motion: z.enum(["full", "reduced", "system"]).optional(),
  faceEnabled: z.boolean().optional(),
}).strict().refine(
  (value) => value.look !== undefined || value.motion !== undefined || value.faceEnabled !== undefined,
  { message: "At least one preference must be supplied." },
);

export function uiPreferencesRoutes(db: Db, auth: RequestHandler): Router {
  const router = Router();

  router.get("/", auth, (_req, res) => {
    res.json({ preferences: getUiPreferences(db) });
  });

  router.patch("/", auth, (req, res) => {
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "bad_request", details: parsed.error.flatten() });
      return;
    }
    const { expectedVersion, ...patch } = parsed.data;
    const result = updateUiPreferences(db, expectedVersion, patch);
    if (!result.ok) {
      res.status(409).json({ error: result.reason, preferences: result.preferences });
      return;
    }
    res.json({ preferences: result.preferences });
  });

  return router;
}
