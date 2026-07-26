import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import type { ObservabilityEvent } from "../observability/types.js";
import type { ObservabilityService } from "../observability/store.js";
import { FORGE_AGENT_ROLES } from "../observability/forge-adapter.js";

export const MISSION_CONTROL_API_VERSION = 1;

const StopBody = z.object({
  expectedVersion: z.number().int().positive(),
});

function numberParam(value: unknown, fallback: number): number {
  if (typeof value !== "string") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function writeEvent(res: Response, event: ObservabilityEvent): void {
  res.write(`id: ${event.seq}\n`);
  res.write("event: mission_event\n");
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

export function missionControlRoutes(
  auth: RequestHandler,
  observability: ObservabilityService,
): Router {
  const router = Router();

  router.get("/meta", auth, (_req, res) => {
    const bounds = observability.store.eventBounds();
    res.json({
      ok: true,
      service: "ava-mission-control",
      apiVersion: MISSION_CONTROL_API_VERSION,
      schemaVersion: 1,
      serverAuthority: "ava",
      controls: ["stop"],
      defaults: {
        autoOpen: false,
        layout: "desktop_three_pane",
        detailedRetentionDays: 30,
        compactRetentionDays: 365,
        screenshots: "off",
        promptVisibility: "sanitised_collapsed",
        uncommittedDiffVisibility: "metadata_then_collapsed",
        directAgentMessages: "forge_internal_router_only",
        approvalOwner: "ava",
      },
      coverage: {
        openAiRealtimeVoice: "vertical_slice",
        avaChatAgent: "vertical_slice",
        humeVoice: "not_yet_instrumented",
        forge: "adapter_contract_ready_not_connected",
        codex: "adapter_contract_ready_not_connected",
        claudeCode: "adapter_contract_ready_not_connected",
      },
      forge: {
        boundary: "separate_runtime_ava_integrated",
        canonicalRoles: FORGE_AGENT_ROLES,
      },
      eventBounds: bounds,
    });
  });

  router.get("/runs", auth, (req, res) => {
    const limit = Math.max(1, Math.min(100, Math.floor(numberParam(req.query.limit, 50))));
    res.json({
      runs: observability.listRuns({ limit }),
      generatedAt: Date.now(),
      apiVersion: MISSION_CONTROL_API_VERSION,
    });
  });

  router.get("/runs/:id", auth, (req, res) => {
    const id = req.params.id;
    if (typeof id !== "string") {
      res.status(400).json({ error: "bad_request", message: "Run ID is required." });
      return;
    }
    const run = observability.getRun(id);
    if (!run) {
      res.status(404).json({
        error: "mission_run_not_found",
        message: "This Mission Control run does not exist or its compact record was removed.",
      });
      return;
    }
    res.json({
      run,
      events: observability.getEvents(id),
      generatedAt: Date.now(),
      apiVersion: MISSION_CONTROL_API_VERSION,
    });
  });

  /**
   * Global cursor stream. The authenticated fetch client supplies `after` when
   * reconnecting; SQLite is authoritative, while the process-local subscriber
   * only removes polling latency. Subscribe before replay and queue arrivals so
   * an event cannot land in the replay/live handoff gap.
   */
  router.get("/stream", auth, (req, res) => {
    const headerCursor = Number(req.headers["last-event-id"] ?? 0);
    const queryCursor = numberParam(req.query.after, 0);
    const after = Math.max(0, Math.floor(Math.max(headerCursor, queryCursor)));

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    res.write(": mission-control connected\n\n");

    let closed = false;
    let replaying = true;
    let lastSent = after;
    const queued: ObservabilityEvent[] = [];
    const send = (event: ObservabilityEvent) => {
      if (closed || event.seq <= lastSent) return;
      writeEvent(res, event);
      lastSent = event.seq;
    };
    const unsubscribe = observability.subscribe((event) => {
      if (replaying) queued.push(event);
      else send(event);
    });

    const bounds = observability.store.eventBounds();
    if (bounds.min !== null && after > 0 && after < bounds.min - 1) {
      res.write("event: gap\n");
      res.write(`data: ${JSON.stringify({ requestedAfter: after, oldestAvailable: bounds.min })}\n\n`);
    }
    // Replay to a stable snapshot in bounded database pages. A single
    // `eventsAfter(..., 2_000)` silently lost the rest of a large offline gap.
    // Arrivals after the snapshot are already queued by the live subscriber.
    const replayThrough = bounds.max ?? after;
    let replayCursor = after;
    while (replayCursor < replayThrough) {
      const page = observability.eventsAfter(replayCursor, 2_000)
        .filter((event) => event.seq <= replayThrough);
      if (page.length === 0) break;
      for (const event of page) send(event);
      replayCursor = page[page.length - 1]!.seq;
    }
    replaying = false;
    for (const event of queued.sort((a, b) => a.seq - b.seq)) send(event);

    const heartbeat = setInterval(() => {
      if (!closed) res.write(`: ping ${Date.now()}\n\n`);
    }, 15_000);
    heartbeat.unref?.();

    req.on("close", () => {
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  /**
   * Stop is deliberately the only Mission Control mutation in v1 and lives on
   * its own endpoint. `expectedVersion` prevents a stale second window from
   * stopping a replacement run that now owns the visual slot.
   */
  router.post("/runs/:id/stop", auth, async (req, res) => {
    const id = req.params.id;
    const parsed = StopBody.safeParse(req.body);
    if (typeof id !== "string" || !parsed.success) {
      res.status(400).json({
        error: "bad_stop_request",
        message: "Run ID and a positive expectedVersion are required.",
      });
      return;
    }
    const result = await observability.requestStop(id, parsed.data.expectedVersion);
    if (!result.ok) {
      const status = result.reason === "not_found" ? 404 : 409;
      res.status(status).json({
        error: result.reason,
        message:
          result.reason === "stale_version"
            ? "The run changed after this window loaded. Refresh before stopping it."
            : result.reason === "not_running"
              ? "The selected run is no longer controlled by an active owner."
              : "The selected run does not exist.",
        run: result.run,
      });
      return;
    }
    res.status(202).json({
      accepted: true,
      run: result.run,
      stopEventId: result.event.eventId,
    });
  });

  return router;
}
