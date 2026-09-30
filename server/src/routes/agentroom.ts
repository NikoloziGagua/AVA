import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { AgentroomService } from "../agentroom/service.js";

const SettingBody = z.object({
  enabled: z.boolean(),
  expectedVersion: z.number().int().positive(),
}).strict();

export function agentroomRoutes(auth: RequestHandler, service: AgentroomService): Router {
  const router = Router();

  router.get("/", auth, async (_req, res) => {
    res.json(await service.status());
  });

  router.post("/", auth, async (req, res) => {
    const parsed = SettingBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "bad_request", details: parsed.error.flatten() });
      return;
    }
    const result = await service.setEnabled(parsed.data.enabled, parsed.data.expectedVersion);
    if (!result.ok) {
      res.status(409).json({ error: result.reason, ...result.status });
      return;
    }
    res.json(result.status);
  });

  return router;
}
