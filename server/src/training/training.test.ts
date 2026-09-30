import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { openInMemoryDb, type Db } from "../state/db.js";
import type { LLMProvider } from "../orchestrator/llm/types.js";
import { createCalendarEvent, getCalendarEvent, listCalendarEvents, updateCalendarEvent } from "../calendar/service.js";
import { blockedAreas, disciplineFromTitle, isHard, readiness, validateProposals, type Busy, type Candidate } from "./rules.js";
import {
  approveSession, insertProposal, logTraining, mergeEntries, saveCheckin, sessionsBetween, skipSaid, trainingWeek, unscheduleSession,
  updateSession, getSession,
} from "./store.js";
import { parseCandidates, planWeek } from "./planner.js";
import { trainingRoutes } from "../routes/training.js";
import { fastTrainingAction, trainingCandidate } from "../lookups/training-actions.js";

// Wed 30 Sep 2026, 14:05 in Dublin (IST, UTC+1). The week runs Mon 28 Sep to Sun 4 Oct.
const NOW = Date.parse("2026-09-30T13:05:00Z");

function provider(reply: (user: string, system: string) => string): LLMProvider & { calls: number } {
  const fake = {
    name: "openai" as const, defaultOrchestratorModel: "big", defaultSideModel: "small", calls: 0,
    stream: async function* () { /* unused */ },
    complete: vi.fn(async (input: { user: string; system: string }) => { fake.calls += 1; return reply(input.user, input.system); }),
  };
  return fake as unknown as LLMProvider & { calls: number };
}

function event(db: Db, date: string, start: string, minutes: number, title: string, kind: "lecture" | "event" | "block" = "lecture") {
  return createCalendarEvent(db, { title, kind, anchorLocalDate: date, startLocalTime: `${start}:00`, durationMinutes: minutes, source: "manual" }, NOW - 86_400_000 * 5);
}

/** A synthetic week shaped like a student's: lectures, a booked class, and one run entered twice. */
function seedWeek(db: Db) {
  event(db, "2026-10-01", "09:00", 60, "Data Science");
  event(db, "2026-10-01", "11:00", 60, "Concurrent Development");
  event(db, "2026-10-02", "09:00", 120, "Agile Software Development");
  event(db, "2026-10-03", "19:00", 120, "Gym / Jujitsu", "event");
  event(db, "2026-10-02", "13:20", 40, "Run", "event");
  event(db, "2026-10-02", "14:00", 30, "Run", "event");
}

const candidate = (over: Partial<Candidate>): Candidate => ({
  discipline: "boxing", localDate: "2026-10-01", startLocalTime: "18:00:00", durationMin: 75, title: "Boxing: pads and bag", plan: [], reason: "", ...over,
});

describe("training rules", () => {
  it("recognises training in the calendar by its title", () => {
    expect(disciplineFromTitle("Gym / Jujitsu")).toBe("bjj");
    expect(disciplineFromTitle("Kickboxing")).toBe("kickboxing");
    expect(disciplineFromTitle("Evening run")).toBe("run");
    expect(disciplineFromTitle("BJJ open mat")).toBe("bjj");
    expect(disciplineFromTitle("Stretch")).toBe("mobility");
    expect(disciplineFromTitle("Data Science")).toBeNull();
  });

  it("knows a hard session, and a boxing slip-roll is not sparring", () => {
    expect(isHard({ discipline: "boxing", text: "Boxing: slip-roll counter, 6 bag rounds", durationMin: 75 })).toBe(false);
    expect(isHard({ discipline: "boxing", text: "Boxing: 6 rounds sparring", durationMin: 60 })).toBe(true);
    expect(isHard({ discipline: "bjj", text: "Drills then rolls", durationMin: 60 })).toBe(true);
    expect(isHard({ discipline: "run", text: "Easy run, 5 km", durationMin: 35 })).toBe(false);
    expect(isHard({ discipline: "run", text: "Long run, 12 km", durationMin: 70 })).toBe(true);
    expect(isHard({ discipline: "mobility", text: "Mobility", durationMin: 120 })).toBe(false);
  });

  it("scores readiness the simple way", () => {
    expect(readiness({ feeling: "ok", sleepHours: 7, sore: [] })).toMatchObject({ score: 70, word: "OK" });
    expect(readiness({ feeling: "tired", sleepHours: 5.5, sore: ["shoulder"] })).toMatchObject({ score: 40, detail: "Slept 5.5 h · shoulder sore" });
    expect(readiness({ feeling: "injured", sleepHours: null, sore: [] })!.score).toBe(20);
    expect(readiness(null)).toBeNull();
    expect([...blockedAreas(["back"])].sort()).toEqual(["lower", "upper"]);
  });

  it("drops proposals that break a rule, with the reason, and fixes nothing", () => {
    const busy: Busy[] = [
      { localDate: "2026-10-01", startMin: 11 * 60, endMin: 12 * 60, title: "Concurrent Development" },
      { localDate: "2026-10-03", startMin: 19 * 60, endMin: 21 * 60, title: "Gym / Jujitsu", training: { discipline: "bjj", hard: true, areas: ["upper", "lower"] } },
    ];
    const { kept, dropped } = validateProposals({
      candidates: [
        candidate({}),
        candidate({ title: "Too close", startLocalTime: "12:15:00", durationMin: 45, discipline: "run" }),
        candidate({ title: "Too late", localDate: "2026-10-02", startLocalTime: "21:30:00", durationMin: 60 }),
        candidate({ title: "Already past", localDate: "2026-09-30", startLocalTime: "14:20:00", durationMin: 30, discipline: "mobility" }),
        candidate({ title: "Second hard day", localDate: "2026-10-03", startLocalTime: "08:00:00", durationMin: 60, discipline: "mma", claimedHard: true }),
        candidate({ title: "Hard after hard", localDate: "2026-10-04", startLocalTime: "10:00:00", durationMin: 60, discipline: "kickboxing", plan: [{ text: "sparring", minutes: 30, methodId: null }] }),
        candidate({ title: "Overlaps the first", startLocalTime: "19:00:00", durationMin: 30, discipline: "mobility" }),
      ],
      busy, week: { from: "2026-09-28", to: "2026-10-04" }, allowed: { from: "2026-09-30", to: "2026-10-04" },
      now: { localDate: "2026-09-30", minutes: 14 * 60 + 5 }, checkin: null,
    });
    expect(kept.map((entry) => entry.title)).toEqual(["Boxing: pads and bag"]);
    expect(Object.fromEntries(dropped.map((entry) => [entry.candidate.title, entry.why]))).toEqual({
      "Too close": "too close to Concurrent Development (11:00–12:00)",
      "Too late": "outside 07:00 to 22:00",
      "Already past": "too soon or already past",
      "Second hard day": "a second hard session that day",
      "Hard after hard": "hard on the same body two days running",
      "Overlaps the first": "too close to another proposal (Boxing: pads and bag)",
    });
  });

  it("keeps a rest day, and keeps sore areas out of the next three days", () => {
    const week = { from: "2026-09-28", to: "2026-10-04" };
    const busy: Busy[] = ["2026-09-28", "2026-09-29", "2026-09-30"].map((localDate) => ({
      localDate, startMin: 7 * 60, endMin: 8 * 60, title: "Run", training: { discipline: "run" as const, hard: false, areas: ["lower" as const] },
    }));
    const every = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"].map((localDate, index) =>
      candidate({ title: `Gym ${index}`, localDate, discipline: "gym", startLocalTime: "17:00:00", durationMin: 30 + index * 10 }));
    const rest = validateProposals({ candidates: every, busy, week, allowed: { from: "2026-10-01", to: "2026-10-04" }, now: { localDate: "2026-09-30", minutes: 900 }, checkin: null });
    expect(rest.dropped).toEqual([{ candidate: expect.objectContaining({ title: "Gym 0" }), why: "keeps one rest day in the week" }]);

    const sore = validateProposals({
      candidates: [candidate({ title: "Boxing tomorrow" }), candidate({ title: "Run tomorrow", discipline: "run", startLocalTime: "07:30:00", durationMin: 30 }),
        candidate({ title: "Boxing later", localDate: "2026-10-03", startLocalTime: "10:00:00" })],
      busy: [], week, allowed: { from: "2026-09-30", to: "2026-10-04" }, now: { localDate: "2026-09-30", minutes: 900 },
      checkin: { localDate: "2026-09-30", feeling: "sore", sore: ["shoulder"] },
    });
    expect(sore.kept.map((entry) => entry.title)).toEqual(["Run tomorrow", "Boxing later"]);
    expect(sore.dropped[0]!.why).toBe("works the shoulder");
  });

  it("reads the planner's JSON and leaves out anything unclear", () => {
    const raw = JSON.stringify({ sessions: [
      { discipline: "boxing", date: "2026-10-01", start: "18:00", minutes: 75, title: "Boxing", hard: false, plan: [{ text: "Bag", minutes: 30, method_id: "made-up" }], reason: "Free after lectures." },
      { discipline: "tennis", date: "2026-10-01", start: "18:00", minutes: 60, title: "Tennis" },
    ] });
    const { candidates, unreadable } = parseCandidates(raw, new Set());
    expect(candidates).toEqual([expect.objectContaining({ startLocalTime: "18:00:00", plan: [{ text: "Bag", minutes: 30, methodId: null }] })]);
    expect(unreadable).toBe(1);
    expect(parseCandidates("not json", new Set())).toEqual({ candidates: [], unreadable: 1 });
  });
});

describe("training sessions and the calendar", () => {
  it("adds nothing to the calendar until approved, then exactly one block; unscheduling archives it", () => {
    const db = openInMemoryDb();
    seedWeek(db);
    const before = listCalendarEvents(db).length;
    const session = insertProposal(db, { discipline: "boxing", localDate: "2026-10-01", startLocalTime: "18:00:00", durationMin: 75, title: "Boxing: pads", plan: [], reason: "Free after lectures." }, NOW);
    expect(listCalendarEvents(db)).toHaveLength(before);
    expect(() => approveSession(db, session.id, { expectedVersion: 7, source: "ava_chat" }, NOW)).toThrow(/changed since/);
    const approved = approveSession(db, session.id, { expectedVersion: 1, source: "ava_voice" }, NOW);
    const events = listCalendarEvents(db);
    expect(events).toHaveLength(before + 1);
    expect(getCalendarEvent(db, approved.calendarEventId!)).toMatchObject({
      kind: "block", recurrenceKind: "none", timeZone: "Europe/Dublin", source: "ava_voice", description: "Training, planned with AVA",
      anchorLocalDate: "2026-10-01", startLocalTime: "18:00:00", durationMinutes: 75, title: "Boxing: pads",
    });
    expect(approved).toMatchObject({ status: "approved", version: 2, calendarEventVersion: 1 });
    expect(() => approveSession(db, session.id, { source: "ava_chat" }, NOW)).toThrow(/already in your calendar/);
    const back = unscheduleSession(db, session.id, { expectedVersion: 2 }, NOW);
    expect(back).toMatchObject({ status: "proposed", calendarEventId: null });
    expect(getCalendarEvent(db, approved.calendarEventId!)!.archivedAt).toBe(NOW);
  });

  it("refuses to approve a time the calendar now fills", () => {
    const db = openInMemoryDb();
    const session = insertProposal(db, { discipline: "run", localDate: "2026-10-01", startLocalTime: "08:00:00", durationMin: 40, title: "Easy run", plan: [], reason: "" }, NOW);
    event(db, "2026-10-01", "08:30", 60, "Extra lecture");
    expect(() => approveSession(db, session.id, { source: "ava_chat" }, NOW)).toThrow(/clashes with Extra lecture \(08:30–09:30\)/);
    expect(listCalendarEvents(db)).toHaveLength(1);
  });

  it("follows the calendar when Sir moves or deletes an approved session there, and refuses a stale unschedule", () => {
    const db = openInMemoryDb();
    const session = insertProposal(db, { discipline: "gym", localDate: "2026-10-02", startLocalTime: "17:00:00", durationMin: 60, title: "Gym", plan: [], reason: "" }, NOW);
    const approved = approveSession(db, session.id, { source: "ava_chat" }, NOW);
    updateCalendarEvent(db, approved.calendarEventId!, 1, { startLocalTime: "18:00:00" }, NOW);
    expect(() => unscheduleSession(db, session.id, { expectedVersion: approved.version }, NOW)).toThrow(/changed in your calendar/);
    trainingWeek(db, {}, NOW);
    const synced = getSession(db, session.id)!;
    expect(synced).toMatchObject({ startLocalTime: "18:00:00", calendarEventVersion: 2, status: "approved" });
    const moved = updateSession(db, session.id, { startLocalTime: "19:00:00" }, { expectedVersion: synced.version }, NOW);
    expect(getCalendarEvent(db, moved.calendarEventId!)).toMatchObject({ startLocalTime: "19:00:00", version: 3 });
    unscheduleSession(db, session.id, { expectedVersion: moved.version }, NOW);
    expect(getSession(db, session.id)!.status).toBe("proposed");
  });

  it("skips what Sir says to skip, taking an approved one out of the calendar", () => {
    const db = openInMemoryDb();
    const session = insertProposal(db, { discipline: "mma", localDate: "2026-10-02", startLocalTime: "18:00:00", durationMin: 60, title: "MMA", plan: [], reason: "" }, NOW);
    const approved = approveSession(db, session.id, { source: "ava_chat" }, NOW);
    const { session: skipped, removed } = skipSaid(db, session.id, NOW);
    expect(removed).toBe(true);
    expect(skipped.status).toBe("skipped");
    expect(getCalendarEvent(db, approved.calendarEventId!)!.archivedAt).toBe(NOW);
  });

  it("logs the planned session, or matches training in the calendar, or adds a new one", () => {
    const db = openInMemoryDb();
    event(db, "2026-09-30", "07:00", 60, "Run", "event");
    const planned = insertProposal(db, { discipline: "boxing", localDate: "2026-09-30", startLocalTime: "18:00:00", durationMin: 75, title: "Boxing", plan: [], reason: "" }, NOW);
    const boxing = logTraining(db, { discipline: "boxing", minutes: 60, effort: 7, sore: ["Shoulder"], source: "voice" }, NOW);
    expect(boxing).toMatchObject({ matched: "planned", session: { id: planned.id, status: "done", minutes: 60, effort: 7, sore: ["shoulder"] } });
    const run = logTraining(db, { discipline: "run", distanceKm: 8, source: "voice" }, NOW);
    expect(run).toMatchObject({ matched: "calendar", session: { title: "Run", startLocalTime: "07:00:00", minutes: 60, distanceKm: 8 } });
    const gym = logTraining(db, { discipline: "gym", minutes: 45, source: "app" }, NOW);
    expect(gym).toMatchObject({ matched: "new", session: { status: "done", startLocalTime: null, minutes: 45 } });
    expect(() => logTraining(db, { discipline: "gym", localDate: "2026-10-02", source: "app" }, NOW)).toThrow(/last two weeks/);
    // The booked run now shows once, as the logged session.
    const today = trainingWeek(db, {}, NOW).days.find((day) => day.today)!;
    expect(today.items.filter((item) => item.kind === "booked")).toEqual([]);
  });

  it("keeps one check-in a day that adds up what Sir says", () => {
    const db = openInMemoryDb();
    expect(() => saveCheckin(db, "2026-09-30", { sleepHours: 5 }, NOW)).toThrow(/How are you feeling/);
    saveCheckin(db, "2026-09-30", { feeling: "ok" }, NOW);
    const later = saveCheckin(db, "2026-09-30", { sleepHours: 5, sore: ["Knee"] }, NOW + 1_000);
    expect(later).toMatchObject({ feeling: "ok", sleepHours: 5, sore: ["knee"] });
    expect(readiness(later)!.score).toBe(60);
  });
});

describe("the training week", () => {
  it("shows lectures, booked training, proposals and a warning for a run entered twice", () => {
    const db = openInMemoryDb();
    seedWeek(db);
    insertProposal(db, { discipline: "boxing", localDate: "2026-10-01", startLocalTime: "18:00:00", durationMin: 75, title: "Boxing", plan: [], reason: "Free after lectures." }, NOW);
    saveCheckin(db, "2026-09-30", { feeling: "ok", sleepHours: 6.5, sore: ["shoulder"] }, NOW);
    const week = trainingWeek(db, {}, NOW);
    expect(week).toMatchObject({ from: "2026-09-28", to: "2026-10-04", today: "2026-09-30", waiting: 1, readiness: { score: 70, word: "OK" } });
    const thu = week.days.find((day) => day.date === "2026-10-01")!;
    expect(thu.items.map((item) => item.kind)).toEqual(["calendar", "calendar", "session"]);
    expect(thu.items[0]).toMatchObject({ label: "Lecture", start: "09:00", end: "10:00" });
    const sat = week.days.find((day) => day.date === "2026-10-03")!;
    expect(sat.items[0]).toMatchObject({ kind: "booked", discipline: "bjj", hard: true });
    expect(week.days.filter((day) => day.past).map((day) => day.date)).toEqual(["2026-09-28", "2026-09-29"]);
    expect(week.cycle).toEqual([
      { discipline: "bjj", done: 0, planned: 1 }, { discipline: "boxing", done: 0, planned: 1 }, { discipline: "run", done: 0, planned: 2 },
    ]);
    expect(week.warnings).toEqual([expect.objectContaining({ date: "2026-10-02", title: "Run (two entries, 13:20 and 14:00)", start: "13:20", end: "14:30" })]);

    mergeEntries(db, week.warnings[0]!.fix!.first, week.warnings[0]!.fix!.second, NOW);
    const after = trainingWeek(db, {}, NOW);
    expect(after.warnings).toEqual([]);
    expect(after.days.find((day) => day.date === "2026-10-02")!.items.filter((item) => item.kind === "booked"))
      .toEqual([expect.objectContaining({ start: "13:20", end: "14:30" })]);
    expect(() => mergeEntries(db, week.warnings[0]!.fix!.first, week.warnings[0]!.fix!.second, NOW)).toThrow();
  });
});

describe("planning a week", () => {
  const reply = JSON.stringify({ sessions: [
    { discipline: "boxing", date: "2026-10-01", start: "18:00", minutes: 75, title: "Boxing: pads, bag rounds", hard: false, plan: [{ text: "Bag", minutes: 40, method_id: null }], reason: "Free after lectures." },
    { discipline: "run", date: "2026-10-02", start: "13:00", minutes: 40, title: "Run over a lecture", hard: false, plan: [], reason: "" },
    { discipline: "gym", date: "2026-10-04", start: "11:00", minutes: 60, title: "Gym: squat, hinge", hard: false, plan: [], reason: "Legs fresh." },
  ] });

  it("stores valid proposals only, replaces earlier ones, and never writes to the calendar", async () => {
    const db = openInMemoryDb();
    seedWeek(db);
    const events = listCalendarEvents(db).length;
    insertProposal(db, { discipline: "mma", localDate: "2026-10-03", startLocalTime: "10:00:00", durationMin: 60, title: "Old proposal", plan: [], reason: "" }, NOW);
    let prompt = "";
    const result = await planWeek({ db, provider: provider((user) => { prompt = user; return reply; }), routine: () => ["Tuesday 19:00 gym or jiu-jitsu"], now: () => NOW });
    expect(result.proposed.map((session) => session.title)).toEqual(["Boxing: pads, bag rounds", "Gym: squat, hinge"]);
    expect(result.dropped).toEqual([{ title: "Run over a lecture", localDate: "2026-10-02", why: "too close to Run (13:20–14:00)" }]);
    expect(result.replaced).toBe(1);
    expect(listCalendarEvents(db)).toHaveLength(events);
    expect(sessionsBetween(db, "2026-09-28", "2026-10-04").map((session) => session.status)).toEqual(["proposed", "proposed"]);
    expect(prompt).toContain("Open for planning: 2026-09-30 to 2026-10-04");
    expect(prompt).toContain("19:00–21:00 Gym / Jujitsu (training booked: bjj)");
    expect(prompt).toContain("Tuesday 19:00 gym or jiu-jitsu");
  });
});

describe("training routes", () => {
  function setup(fake?: LLMProvider) {
    const db = openInMemoryDb();
    const app = express();
    app.use(express.json());
    app.use("/api/training", trainingRoutes(db, ((_req: unknown, _res: unknown, next: () => void) => next()) as never, { provider: fake ?? null, now: () => NOW }));
    return { db, app };
  }

  it("approves with a version (409 when stale), and unschedules on its own endpoint", async () => {
    const { db, app } = setup();
    const session = insertProposal(db, { discipline: "boxing", localDate: "2026-10-01", startLocalTime: "18:00:00", durationMin: 75, title: "Boxing", plan: [], reason: "" }, NOW);
    await request(app).post(`/api/training/sessions/${session.id}/approve`).send({}).expect(400);
    await request(app).post(`/api/training/sessions/${session.id}/approve`).send({ expectedVersion: 9 }).expect(409)
      .expect((res) => expect(res.body.error).toBe("stale_version"));
    expect(listCalendarEvents(db)).toHaveLength(0);
    const approved = (await request(app).post(`/api/training/sessions/${session.id}/approve`).send({ expectedVersion: 1 }).expect(200)).body.session;
    expect(listCalendarEvents(db)).toHaveLength(1);
    await request(app).post(`/api/training/sessions/${session.id}/unschedule`).send({ expectedVersion: 1 }).expect(409);
    await request(app).post(`/api/training/sessions/${session.id}/unschedule`).send({ expectedVersion: approved.version }).expect(200);
    expect(listCalendarEvents(db)[0]!.archivedAt).toBe(NOW);
    const week = (await request(app).get("/api/training?from=2026-10-01").expect(200)).body;
    expect(week.from).toBe("2026-09-28");
  });

  it("logs, checks in, and says when the planner is missing", async () => {
    const { app } = setup();
    await request(app).post("/api/training/log").send({ discipline: "boxing", minutes: 60, effort: 7 }).expect(201)
      .expect((res) => expect(res.body.session).toMatchObject({ status: "done", effort: 7 }));
    await request(app).post("/api/training/log").send({ discipline: "boxing", effort: 11 }).expect(400);
    await request(app).put("/api/training/checkins/2026-09-30").send({ feeling: "tired", sleepHours: 5 }).expect(200)
      .expect((res) => expect(res.body.checkin).toMatchObject({ feeling: "tired", sleepHours: 5 }));
    await request(app).put("/api/training/checkins/2026-10-05").send({ feeling: "ok" }).expect(400);
    await request(app).post("/api/training/plan").send({}).expect(503);
    await request(app).post("/api/training/ask").send({ text: "did boxing" }).expect(200).expect((res) => expect(res.body.handled).toBe(false));
  });
});

describe("the training fast lane", () => {
  const act = (value: Record<string, unknown>) => JSON.stringify({ session_id: null, discipline: null, minutes: null, effort: null, sore: [], notes: null, distance_km: null, duration_s: null, date: null, feeling: null, sleep_hours: null, note: null, range: null, ...value });

  it("wakes for training, how he feels, or a yes right after training talk", () => {
    expect(trainingCandidate("did boxing 60 minutes, effort 7", "")).toBe(true);
    expect(trainingCandidate("I'm tired today", "")).toBe(true);
    expect(trainingCandidate("yes, add them", "AVA: Planned 3 training sessions for this week.")).toBe(true);
    expect(trainingCandidate("yes, add them", "AVA: Here is your shopping list.")).toBe(false);
    expect(trainingCandidate("what's on this week?", "")).toBe(false);
    expect(trainingCandidate("add gym to my calendar today", "")).toBe(false);
    expect(trainingCandidate("add them to my calendar", "AVA: 2 training sessions are waiting.")).toBe(true);
  });

  it("logs \"did boxing 60 minutes, effort 7\" directly with one small-model call", async () => {
    const db = openInMemoryDb();
    const fake = provider(() => act({ action: "log", discipline: "boxing", minutes: 60, effort: 7 }));
    const result = await fastTrainingAction({ db, provider: fake, now: () => NOW }, "did boxing 60 minutes, effort 7", "");
    expect(fake.calls).toBe(1);
    expect(result!.text).toBe("Done, and checked just now: logged Boxing on Wed 30 Sep: 60 min, effort 7. Added as a new session.");
    expect(sessionsBetween(db, "2026-09-30", "2026-09-30")).toEqual([expect.objectContaining({ status: "done", minutes: 60, effort: 7, source: "voice" })]);
  });

  it("checks in, approves all waiting sessions, and hands anything unclear to the agent", async () => {
    const db = openInMemoryDb();
    const checkin = await fastTrainingAction({ db, provider: provider(() => act({ action: "checkin", feeling: "sore", sore: ["shoulder"] })), now: () => NOW }, "I'm sore today, my shoulder", "");
    expect(checkin!.text).toContain("today's check-in is Sore (shoulder sore), readiness 50");
    insertProposal(db, { discipline: "boxing", localDate: "2026-10-01", startLocalTime: "18:00:00", durationMin: 75, title: "Boxing", plan: [], reason: "" }, NOW);
    insertProposal(db, { discipline: "run", localDate: "2026-10-02", startLocalTime: "08:00:00", durationMin: 40, title: "Easy run", plan: [], reason: "" }, NOW);
    const all = await fastTrainingAction({ db, provider: provider(() => act({ action: "approve_all" })), now: () => NOW }, "yes, add them", "AVA: 2 training sessions are waiting.");
    expect(all!.text).toMatch(/^Done, and checked just now: added to the calendar: Boxing on Thu 1 Oct 18:00–19:15/);
    expect(listCalendarEvents(db)).toHaveLength(2);
    expect(await fastTrainingAction({ db, provider: provider(() => act({ action: "approve", session_id: "trs_made_up" })), now: () => NOW }, "add the session", "training")).toBeNull();
    expect(await fastTrainingAction({ db, provider: provider(() => "nonsense"), now: () => NOW }, "how should I train my jab", "")).toBeNull();
  });
});
