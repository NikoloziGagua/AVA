import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { openInMemoryDb, type Db } from "../state/db.js";
import type { LLMProvider } from "../orchestrator/llm/types.js";
import { archiveCalendarEvent, createCalendarEvent, listCalendarEvents } from "../calendar/service.js";
import {
  approveSession, getSession, insertProposal, logTraining, mergeEntries, planningMonday, sessionsBetween, trainingBrief, trainingWeek,
  unskipSession, updateSession,
} from "./store.js";
import { planWeek } from "./planner.js";
import { trainingRoutes } from "../routes/training.js";
import { fastTrainingAction, parseTrainingPlan, trainingCandidate } from "../lookups/training-actions.js";

// Wed 30 Sep 2026, 14:05 in Dublin. Sunday 4 Oct, 10:00 in Dublin.
const NOW = Date.parse("2026-09-30T13:05:00Z");
const SUNDAY = Date.parse("2026-10-04T09:00:00Z");

function provider(reply: (user: string) => string | Promise<string>): LLMProvider {
  return {
    name: "openai", defaultOrchestratorModel: "big", defaultSideModel: "small",
    stream: async function* () { /* unused */ },
    complete: vi.fn(async (input: { user: string }) => reply(input.user)),
  } as unknown as LLMProvider;
}

function event(db: Db, date: string, start: string, minutes: number, title: string, kind: "lecture" | "event" | "block" = "event") {
  return createCalendarEvent(db, { title, kind, anchorLocalDate: date, startLocalTime: `${start}:00`, durationMinutes: minutes, source: "manual" }, NOW - 86_400_000 * 5);
}
const proposal = (db: Db, over: Partial<Parameters<typeof insertProposal>[1]> = {}, now = NOW) =>
  insertProposal(db, { discipline: "run", localDate: "2026-10-03", startLocalTime: "10:00:00", durationMin: 40, title: "Easy run", plan: [], reason: "", ...over }, now);
const act = (value: Record<string, unknown>) => JSON.stringify({ session_id: null, discipline: null, minutes: null, effort: null, sore: [], notes: null, distance_km: null, duration_s: null, date: null, feeling: null, sleep_hours: null, note: null, range: null, ...value });

describe("training review fixes", () => {
  it("blocks every day an overnight entry touches", () => {
    const db = openInMemoryDb();
    event(db, "2026-10-02", "18:00", 36 * 60, "Trip away");
    const run = proposal(db);
    expect(() => approveSession(db, run.id, { source: "ava_chat" }, NOW)).toThrow(/clashes with Trip away \(00:00–24:00\)/);
    const saturday = trainingWeek(db, {}, NOW).days.find((day) => day.date === "2026-10-03")!;
    expect(saturday.items[0]).toMatchObject({ kind: "calendar", start: "00:00", end: "24:00", title: "Trip away" });
    expect(saturday.items[1]).toMatchObject({ kind: "session", conflict: "Clashes with Trip away (00:00–24:00)" });
  });

  it("counts a hard Sunday against a hard Monday in the next week", async () => {
    const db = openInMemoryDb();
    event(db, "2026-10-04", "11:00", 120, "BJJ open mat");
    const reply = JSON.stringify({ sessions: [{ discipline: "mma", date: "2026-10-05", start: "18:00", minutes: 75, title: "MMA sparring", hard: true, plan: [], reason: "" }] });
    const result = await planWeek({ db, provider: provider(() => reply), now: () => NOW }, { from: "2026-10-05" });
    expect(result.proposed).toEqual([]);
    expect(result.dropped[0]!.why).toBe("hard on the same body two days running");
  });

  it("checks proposals again after the model answers, against what changed meanwhile", async () => {
    const db = openInMemoryDb();
    const reply = JSON.stringify({ sessions: [{ discipline: "gym", date: "2026-10-01", start: "18:00", minutes: 60, title: "Gym", hard: false, plan: [], reason: "" }] });
    const slow = provider(() => { event(db, "2026-10-01", "18:30", 60, "Dinner"); return reply; });
    const result = await planWeek({ db, provider: slow, now: () => NOW });
    expect(result.proposed).toEqual([]);
    expect(result.dropped).toEqual([{ title: "Gym", localDate: "2026-10-01", why: "too close to Dinner (18:30–19:30)" }]);
  });

  it("means the week ahead on a Sunday, for planning, approving and reading", async () => {
    const db = openInMemoryDb();
    expect(planningMonday("2026-10-04")).toBe("2026-10-05");
    expect(planningMonday("2026-09-30")).toBe("2026-09-28");
    let prompt = "";
    const planned = await planWeek({ db, provider: provider((user) => { prompt = user; return JSON.stringify({ sessions: [
      { discipline: "boxing", date: "2026-10-06", start: "18:00", minutes: 60, title: "Boxing", hard: false, plan: [], reason: "" },
    ] }); }), now: () => SUNDAY });
    expect(prompt).toContain("Open for planning: 2026-10-05 to 2026-10-11");
    expect(planned.proposed).toHaveLength(1);
    expect(trainingBrief(db, "week", {}, SUNDAY)).toContain("Tue 6 Oct: 18:00–19:00 Boxing [Boxing, waiting for an OK]");
    const all = await fastTrainingAction({ db, provider: provider(() => act({ action: "approve_all" })), now: () => SUNDAY }, "yes, add them", "AVA: 1 proposed training session is waiting for an OK.");
    expect(all!.text).toContain("added to the calendar: Boxing on Tue 6 Oct");
  });

  it("only wakes the fast lane for clear training talk", () => {
    for (const said of ["I'm running late for the lecture", "I feel good about the pitch", "put it in the box", "hotel check-in at 3", "run the backup"]) {
      expect(trainingCandidate(said, ""), said).toBe(false);
    }
    expect(trainingCandidate("yes", "AVA: Want me to run the backup?")).toBe(false);
    for (const said of ["did boxing 60 minutes, effort 7", "went for a run, 8 km", "I'm really tired today", "my shoulder is sore", "plan my week", "ran 5k this morning"]) {
      expect(trainingCandidate(said, ""), said).toBe(true);
    }
    const sessions = new Map([["trs_a", { id: "trs_a", status: "proposed", version: 3 } as never]]);
    expect(parseTrainingPlan(act({ action: "approve_all" }), sessions, "2026-09-30", "what's on this week")).toEqual({ action: "agent" });
    expect(parseTrainingPlan(act({ action: "approve", session_id: "trs_a" }), sessions, "2026-09-30", "yes add it")).toEqual({ action: "approve", sessionId: "trs_a", version: 3 });
    expect(parseTrainingPlan(act({ action: "checkin", feeling: "fresh" }), sessions, "2026-09-30", "gym was great")).toEqual({ action: "agent" });
    expect(parseTrainingPlan(act({ action: "log", discipline: "gym", date: "2026-08-01" }), sessions, "2026-09-30", "did gym in August")).toEqual({ action: "agent" });
  });

  it("corrects a log said again soon after instead of adding a second session", () => {
    const db = openInMemoryDb();
    logTraining(db, { discipline: "boxing", minutes: 60, source: "voice" }, NOW);
    const again = logTraining(db, { discipline: "boxing", minutes: 75, effort: 6, source: "voice" }, NOW + 5 * 60_000);
    expect(again.matched).toBe("corrected");
    expect(sessionsBetween(db, "2026-09-30", "2026-09-30")).toEqual([expect.objectContaining({ minutes: 75, effort: 6, status: "done" })]);
  });

  it("merges only a pair the week view flagged", () => {
    const db = openInMemoryDb();
    const lecture = event(db, "2026-10-02", "09:00", 60, "Data Science", "lecture");
    const meeting = event(db, "2026-10-02", "10:00", 60, "Meeting");
    const ref = (id: string) => ({ occurrenceKey: `${id}:2026-10-02`, eventVersion: 1, exceptionVersion: null });
    expect(() => mergeEntries(db, ref(lecture.id), ref(meeting.id), NOW)).toThrow(/can't be merged/);
    expect(listCalendarEvents(db).every((entry) => entry.version === 1)).toBe(true);
  });

  it("treats a session Sir deleted from the calendar as skipped, and lets him bring it back", () => {
    const db = openInMemoryDb();
    const approved = approveSession(db, proposal(db).id, { source: "ava_chat" }, NOW);
    archiveCalendarEvent(db, approved.calendarEventId!, 1, NOW);
    trainingWeek(db, {}, NOW);
    const skipped = getSession(db, approved.id)!;
    expect(skipped).toMatchObject({ status: "skipped", calendarEventId: null });
    expect(unskipSession(db, approved.id, { expectedVersion: skipped.version }, NOW).status).toBe("proposed");
  });

  it("answers a time the clocks skip with a 400, not a crash", async () => {
    const db = openInMemoryDb();
    const later = proposal(db, { localDate: "2027-03-27" });
    expect(() => updateSession(db, later.id, { localDate: "2027-03-28", startLocalTime: "01:30:00" }, { expectedVersion: 1 }, NOW)).toThrow(/clocks change/);
    const app = express();
    app.use(express.json());
    app.use("/api/training", trainingRoutes(db, ((_req: unknown, _res: unknown, next: () => void) => next()) as never, { now: () => NOW }));
    await request(app).patch(`/api/training/sessions/${later.id}`).send({ expectedVersion: 1, localDate: "2027-03-28", startLocalTime: "01:30" }).expect(400);
    const skipped = (await request(app).post(`/api/training/sessions/${later.id}/skip`).send({}).expect(200)).body.session;
    await request(app).post(`/api/training/sessions/${later.id}/unskip`).send({ expectedVersion: skipped.version }).expect(200);
  });
});
