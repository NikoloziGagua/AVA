import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { Db } from "../state/db.js";
import { createWatch, listWatches, deleteWatch, getWatch, setWatchEnabled } from "../state/watches.js";
import type { WatcherCommunicationEvidence } from "../observability/communications.js";
import { getReminderStatus } from "../state/reminders.js";
import { ReminderScheduleError, validateReminderSchedule } from "../watches/reminder-schedule.js";

const WatchId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

const CreateBody = z.object({
  prompt: z.string().min(1).max(2000),
  interval_minutes: z.number().min(1).max(24 * 60).optional(),
  once: z.boolean().optional(),
  run_at: z.number().optional(),                                  // epoch ms one-shot
  time_zone: z.string().max(100).optional(),
  daily_at: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/).optional(),
  kind: z.enum(["check", "reminder"]).optional(),
}).refine((b) => b.interval_minutes || b.run_at || b.daily_at, { message: "need a schedule" });
const ToggleBody = z.object({ enabled: z.boolean() });

export type WatchesRouteOptions = {
  resolveCommunicationEvidence?: (watcherId: string) => WatcherCommunicationEvidence;
};

function communicationEvidenceForWatch(
  watcherId: string,
  resolve: WatchesRouteOptions["resolveCommunicationEvidence"],
): WatcherCommunicationEvidence {
  if (!WatchId.safeParse(watcherId).success) return { availability: "unavailable" };
  try {
    const evidence = resolve?.(watcherId);
    return evidence?.availability === "available" &&
      evidence.runId === `communication:codex_watcher:${watcherId}`
      ? evidence
      : { availability: "unavailable" };
  } catch {
    // Missing, inaccessible and failed resolution deliberately look alike.
    return { availability: "unavailable" };
  }
}

/** Read/manage surface for standing watches (long-term monitoring). */
export function watchesRoutes(db: Db, auth: RequestHandler, options: WatchesRouteOptions = {}): Router {
  const r = Router();
  r.get("/", auth, (_req, res) => {
    const watches = listWatches(db).map((watch) => {
      if (watch.kind !== "codex") return { ...watch, reminder_status: getReminderStatus(db, watch) };
      return {
        ...watch,
        communication_evidence: communicationEvidenceForWatch(
          watch.id,
          options.resolveCommunicationEvidence,
        ),
      };
    });
    res.json({ watches });
  });
  /**
   * Narrow read model for a receipt already proven in the authenticated Watch
   * collection. It deliberately returns the same ID-free unavailable shape for
   * malformed, deleted, wrong-kind, inaccessible and resolver-error cases.
   */
  r.get("/:id/communication-evidence", auth, (req, res) => {
    const id = req.params.id;
    const watch = typeof id === "string" && WatchId.safeParse(id).success ? getWatch(db, id) : null;
    res.setHeader("Cache-Control", "no-store");
    res.json({
      communication_evidence: watch?.kind === "codex"
        ? communicationEvidenceForWatch(watch.id, options.resolveCommunicationEvidence)
        : { availability: "unavailable" },
    });
  });
  r.post("/", auth, (req, res) => {
    const p = CreateBody.safeParse(req.body);
    if (!p.success) { res.status(400).json({ error: "bad_request" }); return; }
    let timeZone: string | undefined;
    if (p.data.kind === "reminder" && p.data.run_at !== undefined) {
      try {
        timeZone = validateReminderSchedule({ runAt: p.data.run_at, timeZone: p.data.time_zone,
          intervalMinutes: p.data.interval_minutes, dailyAt: p.data.daily_at, once: p.data.once }).timeZone;
      } catch (error) {
        res.status(400).json({ error: "bad_request", ...(error instanceof ReminderScheduleError ? { reasonCode: error.code } : {}) });
        return;
      }
    }
    const watch = createWatch(db, {
      prompt: p.data.prompt, intervalMinutes: p.data.interval_minutes, once: p.data.once,
      runAt: p.data.run_at, timeZone, dailyAt: p.data.daily_at, kind: p.data.kind,
    });
    res.json({ watch: { ...watch, reminder_status: getReminderStatus(db, watch) } });
  });
  r.post("/:id/enabled", auth, (req, res) => {
    const p = ToggleBody.safeParse(req.body);
    if (!p.success || typeof req.params.id !== "string") { res.status(400).json({ error: "bad_request" }); return; }
    setWatchEnabled(db, req.params.id, p.data.enabled);
    res.json({ ok: true });
  });
  r.delete("/:id", auth, (req, res) => {
    const id = req.params.id;
    if (typeof id !== "string") { res.status(400).json({ error: "bad_request" }); return; }
    res.json({ deleted: deleteWatch(db, id) });
  });
  return r;
}
