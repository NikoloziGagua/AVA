import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { StrategyEvent } from "../strategy/types.js";
import { StrategyRoomCoordinator } from "../strategy/coordinator.js";

const CreateBody = z.object({ topic: z.string().trim().min(1).max(8_000) });
const MessageBody = z.object({ content: z.string().trim().min(1).max(8_000) });
const VersionBody = z.object({ expectedVersion: z.number().int().positive() });

function numberParam(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function writeEvent(res: { write: (value: string) => unknown }, event: StrategyEvent): void {
  res.write(`id: ${event.seq}\n`);
  res.write("event: strategy_event\n");
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function decisionError(
  res: { status: (code: number) => { json: (body: unknown) => void } },
  result: Exclude<ReturnType<StrategyRoomCoordinator["approve"]>, { ok: true }>,
): void {
  const status = result.reason === "not_found" ? 404 : 409;
  res.status(status).json({ error: result.reason, room: result.room });
}

export function strategyRoutes(auth: RequestHandler, coordinator: StrategyRoomCoordinator): Router {
  const router = Router();
  const store = coordinator.deps.store;

  router.get("/meta", auth, async (_req, res) => {
    const codex = await coordinator.deps.codex.probe();
    res.json({
      service: "ava-strategy-room",
      apiVersion: 1,
      authority: "ava",
      participants: {
        niko: { available: true, role: "owner" },
        ava: { available: coordinator.deps.provider !== null, role: "facilitator" },
        codex: { available: codex.available, role: "critical collaborator", version: codex.version, error: codex.error },
      },
      controls: ["message", "pause", "resume", "approve_conclusion"],
      approvalEffect: "records_decision_only",
      codexBoundary: "dedicated_read_only_resumable_cli_thread",
      eventBounds: store.eventBounds(),
    });
  });

  router.get("/rooms", auth, (req, res) => {
    const limit = Math.max(1, Math.min(100, Math.floor(numberParam(req.query.limit, 50))));
    res.json({ rooms: store.listRooms(limit), generatedAt: Date.now() });
  });

  router.post("/rooms", auth, (req, res) => {
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "bad_request", details: parsed.error.flatten() });
      return;
    }
    const created = coordinator.create(parsed.data.topic);
    res.status(202).json(store.getDetail(created.room.id));
  });

  router.get("/rooms/:id", auth, (req, res) => {
    const id = String(req.params.id ?? "");
    const detail = store.getDetail(id);
    if (!detail) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json(detail);
  });

  // Appending Niko's message is intentionally a separate endpoint from plan
  // approval. It interrupts/restarts the bounded discussion but cannot execute
  // a development action.
  router.post("/rooms/:id/messages", auth, (req, res) => {
    const parsed = MessageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "bad_request", details: parsed.error.flatten() });
      return;
    }
    const detail = coordinator.addNikoMessage(String(req.params.id ?? ""), parsed.data.content);
    if (!detail) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.status(202).json(detail);
  });

  router.post("/rooms/:id/approve", auth, (req, res) => {
    const parsed = VersionBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "bad_request" }); return; }
    const result = coordinator.approve(String(req.params.id ?? ""), parsed.data.expectedVersion);
    if (!result.ok) { decisionError(res, result); return; }
    res.json({ approved: true, room: result.room });
  });

  router.post("/rooms/:id/pause", auth, (req, res) => {
    const parsed = VersionBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "bad_request" }); return; }
    const result = coordinator.stop(String(req.params.id ?? ""), parsed.data.expectedVersion);
    if (!result.ok) { decisionError(res, result); return; }
    res.json({ paused: true, room: result.room });
  });

  router.post("/rooms/:id/resume", auth, (req, res) => {
    const parsed = VersionBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "bad_request" }); return; }
    const result = coordinator.resume(String(req.params.id ?? ""), parsed.data.expectedVersion);
    if (!result.ok) { decisionError(res, result); return; }
    res.status(202).json({ resumed: true, room: result.room });
  });

  router.get("/stream", auth, (req, res) => {
    const headerCursor = numberParam(req.headers["last-event-id"], 0);
    const queryCursor = numberParam(req.query.after, 0);
    const after = Math.max(0, Math.floor(Math.max(headerCursor, queryCursor)));

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    res.write(": strategy-room connected\n\n");

    let closed = false;
    let replaying = true;
    let lastSent = after;
    const queued: StrategyEvent[] = [];
    const send = (event: StrategyEvent) => {
      if (closed || event.seq <= lastSent) return;
      writeEvent(res, event);
      lastSent = event.seq;
    };
    const unsubscribe = store.subscribe((event) => {
      if (replaying) queued.push(event);
      else send(event);
    });

    const bounds = store.eventBounds();
    if (bounds.min !== null && after > 0 && after < bounds.min - 1) {
      res.write("event: gap\n");
      res.write(`data: ${JSON.stringify({ requestedAfter: after, oldestAvailable: bounds.min })}\n\n`);
    }
    const replayThrough = bounds.max ?? after;
    let cursor = after;
    while (cursor < replayThrough) {
      const page = store.eventsAfter(cursor, 2_000).filter((event) => event.seq <= replayThrough);
      if (page.length === 0) break;
      for (const event of page) send(event);
      cursor = page.at(-1)!.seq;
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

  return router;
}
