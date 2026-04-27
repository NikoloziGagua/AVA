import { Router } from "express";

export function healthRoutes(startedAt: number): Router {
  const r = Router();
  r.get("/health", (_req, res) => {
    res.json({
      ok: true,
      uptime: Date.now() - startedAt,
      version: "0.0.1",
    });
  });
  return r;
}
