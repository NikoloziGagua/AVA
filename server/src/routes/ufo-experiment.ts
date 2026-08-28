import { Router, type RequestHandler } from "express";
import type { UfoExperimentService } from "../ufo/experiment.js";

export function ufoExperimentRoutes(auth: RequestHandler, service: UfoExperimentService): Router {
  const router = Router();
  router.get("/health", auth, (_req, res) => { res.json(service.health()); });
  router.get("/requests/:id", auth, (req, res) => {
    const id = typeof req.params.id === "string" ? req.params.id : "";
    if (!/^ufo_req_[a-f0-9]{18}$/.test(id)) {
      res.status(400).json({ error: "invalid_request_id" }); return;
    }
    const record = service.get(id);
    if (!record) { res.status(404).json({ error: "request_not_found" }); return; }
    res.json(record);
  });
  return router;
}
