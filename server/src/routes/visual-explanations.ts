import { Router, type RequestHandler } from "express";
import type { Db } from "../state/db.js";
import {
  createVisualExplanation,
  getVisualExplanation,
  listVisualExplanations,
} from "../state/visual-explanations.js";
import { VisualExplanationValidationError, type CreateVisualExplanationInput } from "../visual-explanations/model.js";

export function visualExplanationRoutes(db: Db, auth: RequestHandler): Router {
  const router = Router();

  router.get("/", auth, (req, res) => {
    const raw = req.query.limit;
    const limit = raw === undefined ? 40 : Number(raw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      res.status(400).json({ error: "bad_request", message: "limit must be an integer from 1 to 50" });
      return;
    }
    res.json({ visuals: listVisualExplanations(db, limit) });
  });

  router.get("/:id", auth, (req, res) => {
    const id = typeof req.params.id === "string" ? req.params.id : "";
    if (!/^visual_[A-Za-z0-9_-]{8,32}$/.test(id)) {
      res.status(400).json({ error: "bad_request", message: "invalid visual explanation ID" });
      return;
    }
    const visual = getVisualExplanation(db, id);
    if (!visual) {
      res.status(404).json({ error: "visual_explanation_not_found" });
      return;
    }
    res.json({ visual });
  });

  router.post("/", auth, (req, res) => {
    try {
      const result = createVisualExplanation(db, req.body as CreateVisualExplanationInput, { source: "manual" });
      res.status(result.created ? 201 : 200).json(result);
    } catch (error) {
      if (error instanceof VisualExplanationValidationError) {
        res.status(400).json({ error: "invalid_visual_explanation", issues: error.issues });
        return;
      }
      throw error;
    }
  });

  return router;
}

