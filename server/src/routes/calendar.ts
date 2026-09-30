import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import type { Db } from "../state/db.js";
import {
  CALENDAR_ATTENDANCE_INTENTS,
  CALENDAR_ATTENDANCE_OUTCOMES,
  CALENDAR_DST_POLICIES,
  CALENDAR_EVENT_KINDS,
  CALENDAR_RECURRENCE_KINDS,
  CalendarError,
} from "../calendar/types.js";
import {
  archiveCalendarEvent,
  createCalendarEvent,
  endCalendarSeries,
  extendCalendarSeries,
  queryCalendar,
  restoreCalendarEvent,
  splitCalendarEvent,
  updateCalendarEvent,
  upsertCalendarException,
} from "../calendar/service.js";

const EventId = z.string().regex(/^cal_[A-Za-z0-9_-]{1,64}$/);
const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const LocalTime = z.string().regex(/^\d{2}:\d{2}:\d{2}$/);

const CreateBody = z.object({
  title: z.string().min(1).max(160),
  description: z.string().max(5_000).optional(),
  location: z.string().max(500).optional(),
  kind: z.enum(CALENDAR_EVENT_KINDS),
  timeZone: z.string().max(100).optional(),
  anchorLocalDate: LocalDate,
  startLocalTime: LocalTime,
  durationMinutes: z.number().int().min(1).max(10_080),
  recurrenceKind: z.enum(CALENDAR_RECURRENCE_KINDS).optional(),
  recurrenceUntilDate: LocalDate.nullable().optional(),
  dstPolicy: z.enum(CALENDAR_DST_POLICIES).optional(),
  attendanceIntent: z.enum(CALENDAR_ATTENDANCE_INTENTS).optional(),
  notesFolderId: z.string().max(120).nullable().optional(),
  reminderMinutesBefore: z.number().int().min(0).max(10_080).nullable().optional(),
}).strict();

const PatchBody = CreateBody.partial().extend({ expectedVersion: z.number().int().positive() });

const ExceptionBody = z.object({
  expectedEventVersion: z.number().int().positive(),
  expectedExceptionVersion: z.number().int().nonnegative().nullable().default(null),
  movedLocalDate: LocalDate.nullable().optional(),
  movedLocalTime: LocalTime.nullable().optional(),
  movedDurationMinutes: z.number().int().min(1).max(10_080).nullable().optional(),
  cancelled: z.boolean().optional(),
  attendanceIntentOverride: z.enum(CALENDAR_ATTENDANCE_INTENTS).nullable().optional(),
  attendanceOutcome: z.enum(CALENDAR_ATTENDANCE_OUTCOMES).optional(),
}).strict();

const SplitBody = z.object({
  expectedVersion: z.number().int().positive(),
  splitOriginalDate: LocalDate,
  changes: CreateBody.partial().default({}),
}).strict();

const VersionBody = z.object({ expectedVersion: z.number().int().positive() }).strict();
const EndBody = VersionBody.extend({ fromOriginalDate: LocalDate });
const ExtendBody = VersionBody.extend({ recurrenceUntilDate: LocalDate });
const ArchiveQuery = z.object({
  expectedVersion: z.string().regex(/^[1-9]\d*$/).transform(Number).refine(Number.isSafeInteger),
  includeHistory: z.enum(["true", "false"]).optional(),
}).strict();

function failure(res: Response, error: unknown): void {
  if (!(error instanceof CalendarError)) {
    res.status(400).json({ error: "bad_request" });
    return;
  }
  const status = error.code === "not_found" || error.code === "occurrence_not_found" ? 404
    : error.code === "stale_version" ? 409
      : 400;
  res.status(status).json({ error: error.code, message: error.message });
}

export function calendarRoutes(
  db: Db,
  auth: RequestHandler,
  options: { now?: () => number } = {},
): Router {
  const r = Router();
  const now = options.now ?? Date.now;

  r.get("/events", auth, (req, res) => {
    const from = Number(req.query.from);
    const to = Number(req.query.to);
    const timeZone = typeof req.query.timeZone === "string" ? req.query.timeZone : "Europe/Dublin";
    try { res.json(queryCalendar(db, from, to, timeZone, now())); }
    catch (error) { failure(res, error); }
  });

  r.post("/events", auth, (req, res) => {
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "bad_request" }); return; }
    try {
      const event = createCalendarEvent(db, { ...parsed.data, source: "manual" }, now());
      res.status(201).json({ event });
    } catch (error) { failure(res, error); }
  });

  r.patch("/events/:id", auth, (req, res) => {
    const id = EventId.safeParse(req.params.id);
    const parsed = PatchBody.safeParse(req.body);
    if (!id.success || !parsed.success) { res.status(400).json({ error: "bad_request" }); return; }
    const { expectedVersion, ...patch } = parsed.data;
    try {
      const event = updateCalendarEvent(db, id.data, expectedVersion, patch, now());
      res.json({ event, changed: event.version !== expectedVersion });
    }
    catch (error) { failure(res, error); }
  });

  r.delete("/events/:id", auth, (req, res) => {
    const id = EventId.safeParse(req.params.id);
    const parsed = ArchiveQuery.safeParse(req.query);
    if (!id.success || !parsed.success) {
      res.status(400).json({ error: "bad_request" }); return;
    }
    try { res.json({ event: archiveCalendarEvent(db, id.data, parsed.data.expectedVersion, now(), parsed.data.includeHistory === "true") }); }
    catch (error) { failure(res, error); }
  });

  r.post("/events/:id/restore", auth, (req, res) => {
    const id = EventId.safeParse(req.params.id), body = VersionBody.safeParse(req.body);
    if (!id.success || !body.success) { res.status(400).json({ error: "bad_request" }); return; }
    try { res.json(restoreCalendarEvent(db, id.data, body.data.expectedVersion, now())); }
    catch (error) { failure(res, error); }
  });

  r.post("/events/:id/end", auth, (req, res) => {
    const id = EventId.safeParse(req.params.id), body = EndBody.safeParse(req.body);
    if (!id.success || !body.success) { res.status(400).json({ error: "bad_request" }); return; }
    try { res.json(endCalendarSeries(db, id.data, body.data.expectedVersion, body.data.fromOriginalDate, now())); }
    catch (error) { failure(res, error); }
  });

  r.post("/events/:id/extend", auth, (req, res) => {
    const id = EventId.safeParse(req.params.id), body = ExtendBody.safeParse(req.body);
    if (!id.success || !body.success) { res.status(400).json({ error: "bad_request" }); return; }
    try { res.json(extendCalendarSeries(db, id.data, body.data.expectedVersion, body.data.recurrenceUntilDate, now())); }
    catch (error) { failure(res, error); }
  });

  r.put("/events/:id/occurrences/:originalDate", auth, (req, res) => {
    const id = EventId.safeParse(req.params.id);
    const date = LocalDate.safeParse(req.params.originalDate);
    const parsed = ExceptionBody.safeParse(req.body);
    if (!id.success || !date.success || !parsed.success) {
      res.status(400).json({ error: "bad_request" }); return;
    }
    const { expectedEventVersion, expectedExceptionVersion, ...patch } = parsed.data;
    try {
      const exception = upsertCalendarException(
        db, id.data, date.data, expectedEventVersion, expectedExceptionVersion, patch, now(),
      );
      res.json({ exception, changed: (exception?.version ?? 0) !== (expectedExceptionVersion ?? 0) });
    } catch (error) { failure(res, error); }
  });

  r.post("/events/:id/split", auth, (req, res) => {
    const id = EventId.safeParse(req.params.id);
    const parsed = SplitBody.safeParse(req.body);
    if (!id.success || !parsed.success) { res.status(400).json({ error: "bad_request" }); return; }
    try {
      res.status(201).json(splitCalendarEvent(
        db, id.data, parsed.data.expectedVersion, parsed.data.splitOriginalDate, parsed.data.changes, now(),
      ));
    } catch (error) { failure(res, error); }
  });

  return r;
}
