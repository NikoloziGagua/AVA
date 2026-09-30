import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import type { Db } from "../state/db.js";
import type { LLMProvider } from "../orchestrator/llm/types.js";
import { DISCIPLINES, FEELINGS } from "../training/rules.js";
import {
  TrainingError, approveSession, logSession, logTraining, mergeEntries, saveCheckin, skipSession, trainingWeek, unscheduleSession,
  unskipSession, updateSession,
} from "../training/store.js";
import { planWeek } from "../training/planner.js";
import { fastTrainingAction } from "../lookups/training-actions.js";

const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const LocalTime = z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/).transform((value) => value.length === 5 ? `${value}:00` : value);
const Version = z.number().int().positive();
const Sore = z.array(z.string().trim().min(1).max(40)).max(8);
const Block = z.object({ text: z.string().trim().min(1).max(160), minutes: z.number().int().min(1).max(300).nullable(), methodId: z.string().max(40).nullable() }).strict();

const VersionBody = z.object({ expectedVersion: Version }).strict();
const OptionalVersionBody = z.object({ expectedVersion: Version.optional() }).strict();
const PlanBody = z.object({ from: LocalDate.optional() }).strict();
const PatchBody = z.object({
  expectedVersion: Version, localDate: LocalDate.optional(), startLocalTime: LocalTime.optional(),
  durationMin: z.number().int().min(10).max(300).optional(), title: z.string().max(120).optional(), plan: z.array(Block).max(12).optional(),
}).strict();
const LogFields = {
  minutes: z.number().int().min(1).max(600).nullable().optional(), effort: z.number().int().min(1).max(10).nullable().optional(),
  sore: Sore.optional(), notes: z.string().max(1_000).optional(),
  distanceKm: z.number().min(0).max(200).nullable().optional(), durationS: z.number().int().min(0).max(86_400).nullable().optional(),
};
const SessionLogBody = z.object({ expectedVersion: Version.optional(), ...LogFields }).strict();
const LogBody = z.object({ discipline: z.enum(DISCIPLINES), localDate: LocalDate.optional(), title: z.string().max(120).optional(), ...LogFields }).strict();
const CheckinBody = z.object({
  feeling: z.enum(FEELINGS).optional(), sore: Sore.optional(), sleepHours: z.number().min(0).max(16).nullable().optional(), note: z.string().max(500).optional(),
}).strict();
const Ref = z.object({ occurrenceKey: z.string().max(200), eventVersion: Version, exceptionVersion: z.number().int().positive().nullable() }).strict();
const MergeBody = z.object({ first: Ref, second: Ref }).strict();
const ApproveAllBody = z.object({ sessions: z.array(z.object({ id: z.string().max(40), expectedVersion: Version }).strict()).min(1).max(20) }).strict();
const AskBody = z.object({ text: z.string().trim().min(1).max(600) }).strict();

function fail(res: Response, error: unknown): void {
  if (error instanceof TrainingError) {
    const status = error.code === "not_found" ? 404 : error.code === "invalid" ? 400 : 409;
    res.status(status).json({ error: error.code, message: error.message });
    return;
  }
  throw error;
}

/**
 * The Training tab (docs/design/ava-training.md). Planning never writes to the
 * calendar; approving writes one event, and removing it is its own endpoint.
 * Every calendar write names the version it saw.
 */
export function trainingRoutes(db: Db, auth: RequestHandler, deps: { provider?: LLMProvider | null; routine?: () => string[]; now?: () => number } = {}): Router {
  const r = Router();
  const now = deps.now ?? Date.now;
  const bad = (res: Response) => { res.status(400).json({ error: "bad_request" }); };

  r.get("/", auth, (req, res) => {
    const from = typeof req.query.from === "string" && LocalDate.safeParse(req.query.from).success ? req.query.from : undefined;
    res.json(trainingWeek(db, { from }, now()));
  });

  r.post("/plan", auth, async (req, res) => {
    const parsed = PlanBody.safeParse(req.body ?? {});
    if (!parsed.success) { bad(res); return; }
    if (!deps.provider) { res.status(503).json({ error: "unavailable", message: "AVA's planner isn't available right now." }); return; }
    try {
      const result = await planWeek({ db, provider: deps.provider, routine: deps.routine, now }, parsed.data);
      res.json({ result, week: trainingWeek(db, { from: result.from }, now()) });
    } catch (error) {
      if (error instanceof TrainingError) { fail(res, error); return; }
      res.status(502).json({ error: "planner_failed", message: "The planner didn't answer. Try again." });
    }
  });

  r.post("/sessions/:id/approve", auth, (req, res) => {
    const parsed = VersionBody.safeParse(req.body);
    if (!parsed.success) { bad(res); return; }
    try { res.json({ session: approveSession(db, String(req.params.id), { expectedVersion: parsed.data.expectedVersion, source: "ava_chat" }, now()) }); }
    catch (error) { fail(res, error); }
  });

  // Each one is approved on its own: one that changed or now clashes is reported, the rest still go in.
  r.post("/approve-all", auth, (req, res) => {
    const parsed = ApproveAllBody.safeParse(req.body);
    if (!parsed.success) { bad(res); return; }
    const approved: unknown[] = [], failed: Array<{ id: string; error: string; message: string }> = [];
    for (const entry of parsed.data.sessions) {
      try { approved.push(approveSession(db, entry.id, { expectedVersion: entry.expectedVersion, source: "ava_chat" }, now())); }
      catch (error) {
        if (!(error instanceof TrainingError)) throw error;
        failed.push({ id: entry.id, error: error.code, message: error.message });
      }
    }
    res.json({ approved, failed });
  });

  r.post("/sessions/:id/skip", auth, (req, res) => {
    const parsed = OptionalVersionBody.safeParse(req.body ?? {});
    if (!parsed.success) { bad(res); return; }
    try { res.json({ session: skipSession(db, String(req.params.id), parsed.data, now()) }); } catch (error) { fail(res, error); }
  });

  // Undo for a skip (a mis-tap on the X, or a session deleted from the calendar).
  r.post("/sessions/:id/unskip", auth, (req, res) => {
    const parsed = OptionalVersionBody.safeParse(req.body ?? {});
    if (!parsed.success) { bad(res); return; }
    try { res.json({ session: unskipSession(db, String(req.params.id), parsed.data, now()) }); } catch (error) { fail(res, error); }
  });

  r.post("/sessions/:id/unschedule", auth, (req, res) => {
    const parsed = VersionBody.safeParse(req.body);
    if (!parsed.success) { bad(res); return; }
    try { res.json({ session: unscheduleSession(db, String(req.params.id), parsed.data, now()) }); } catch (error) { fail(res, error); }
  });

  r.patch("/sessions/:id", auth, (req, res) => {
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) { bad(res); return; }
    const { expectedVersion, ...patch } = parsed.data;
    try { res.json({ session: updateSession(db, String(req.params.id), patch, { expectedVersion }, now()) }); } catch (error) { fail(res, error); }
  });

  r.post("/sessions/:id/log", auth, (req, res) => {
    const parsed = SessionLogBody.safeParse(req.body);
    if (!parsed.success) { bad(res); return; }
    const { expectedVersion, ...log } = parsed.data;
    try { res.json({ session: logSession(db, String(req.params.id), log, { expectedVersion }, now()) }); } catch (error) { fail(res, error); }
  });

  r.post("/log", auth, (req, res) => {
    const parsed = LogBody.safeParse(req.body);
    if (!parsed.success) { bad(res); return; }
    try { res.status(201).json(logTraining(db, { ...parsed.data, source: "app" }, now())); } catch (error) { fail(res, error); }
  });

  r.put("/checkins/:date", auth, (req, res) => {
    const date = LocalDate.safeParse(req.params.date), parsed = CheckinBody.safeParse(req.body);
    if (!date.success || !parsed.success) { bad(res); return; }
    try { res.json({ checkin: saveCheckin(db, date.data, parsed.data, now()) }); } catch (error) { fail(res, error); }
  });

  // Sir presses Merge on a warning; AVA never edits his own calendar entries otherwise.
  r.post("/merge", auth, (req, res) => {
    const parsed = MergeBody.safeParse(req.body);
    if (!parsed.success) { bad(res); return; }
    try { mergeEntries(db, parsed.data.first, parsed.data.second, now()); res.json({ ok: true }); } catch (error) { fail(res, error); }
  });

  // The Training tab's ask-bar: the same fast lane as voice. Anything it can't
  // do at once comes back unhandled, and the app hands it to a conversation.
  r.post("/ask", auth, async (req, res) => {
    const parsed = AskBody.safeParse(req.body);
    if (!parsed.success) { bad(res); return; }
    if (!deps.provider) { res.json({ handled: false }); return; }
    const result = await fastTrainingAction({ db, provider: deps.provider, routine: deps.routine, now }, parsed.data.text, "", undefined, "app").catch(() => null);
    res.json(result ? { handled: true, text: result.text } : { handled: false });
  });

  return r;
}
