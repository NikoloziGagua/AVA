import { Router } from "express";

export type HealthRouteState = {
  /** Null means the server booted but chat cannot run. */
  provider: string | null;
  /** Immutable identifier captured from this process's built artifact at boot. */
  buildId?: string;
};

export function healthRoutes(
  startedAt: number,
  state: HealthRouteState = { provider: null },
): Router {
  const r = Router();
  r.get("/health", (_req, res) => {
    const issues = state.provider ? [] : ["no_llm_provider"];
    res.json({
      // `ok` is process liveness and intentionally remains true so boot smoke
      // and the self-update watchdog can distinguish "server did not boot" from
      // "server booted but needs configuration".
      ok: true,
      ready: issues.length === 0,
      provider: state.provider,
      issues,
      uptime: Date.now() - startedAt,
      version: "0.0.1",
      buildId: state.buildId ?? "unknown",
    });
  });
  return r;
}
