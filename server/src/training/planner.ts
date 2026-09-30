import type { Db } from "../state/db.js";
import type { LLMProvider } from "../orchestrator/llm/types.js";
import type { MemoryArchive } from "../memory-archive/archive.js";
import { addLocalDays } from "../calendar/time.js";
import {
  DISCIPLINES, DISCIPLINE_LABEL, validateProposals, type Candidate, type Discipline, type PlanBlock,
} from "./rules.js";
import {
  TrainingError, busyFor, clean, clearProposals, dayLabel, getCheckin, insertProposal, localNow, mondayOf, planningMonday, sessionsBetween,
  syncWithCalendar, timeRange, weekCalendar, type TrainingSession,
} from "./store.js";

// Planning is one model call with clear inputs, then strict checks in code
// (rules.ts). It never writes to the calendar: proposals wait for Sir's OK.

export type PlanResult = {
  from: string; to: string;
  proposed: TrainingSession[];
  /** Ideas the model had that broke a rule, with why. They were dropped, not fixed. */
  dropped: Array<{ title: string; localDate: string; why: string }>;
  /** Unapproved proposals that were replaced. */
  replaced: number;
};

export type PlannerDeps = {
  db: Db;
  provider: LLMProvider;
  /** What AVA remembers about Sir's routine (a regular class, a usual slot). */
  routine?: () => string[];
  now?: () => number;
};

const SYSTEM = `You plan Sir's (Niko's) training for the open days given. He trains mobility, jiu-jitsu (bjj), boxing, kickboxing, MMA (mma), gym sessions and running (run).
He has no main goal and no fixed targets: propose a sensible, varied set of sessions around his calendar. He approves each one.
Code checks every proposal and drops any that breaks a rule, so follow these exactly:
- Only on the open dates, between 07:00 and 22:00 Dublin time.
- Leave 30 minutes of travel time: start at least 30 minutes after anything else ends, and end at least 30 minutes before anything else starts.
- At most one hard session per day (hard = fighting with sparring or rolling, heavy gym, or a long or fast run), counting training already booked. Never hard on two days running for the same body area (upper: boxing, upper-body gym; lower: running, leg gym; kickboxing, MMA and jiu-jitsu load both).
- At least one rest or mobility-only day in the Monday-to-Sunday week.
- If today's check-in is sore or injured: nothing hard for 3 days, and nothing that works the sore area.
- At most 7 sessions; fewer is fine. Don't duplicate training already booked, and prefer days without it.
- Use his recent logs: after hard or high-effort days, go lighter.
- Plan blocks add up to about the session length. If a method is being tested, put it in a block with its method_id.
- "reason" is one short plain line on why this slot and this session, e.g. "Free after lectures. Easy after Tuesday's rolls."
Reply with JSON only:
{"sessions":[{"discipline":"mobility|bjj|boxing|kickboxing|mma|gym|run","date":"YYYY-MM-DD","start":"HH:MM","minutes":number,"title":string,"hard":boolean,"plan":[{"text":string,"minutes":number,"method_id":string|null}],"reason":string}]}`;

/**
 * What is already fixed around the week: calendar entries, booked training, and
 * approved or done sessions. The day either side is included so a hard Sunday
 * still counts against a hard Monday.
 */
function fixedAround(db: Db, from: string, to: string, now: number) {
  syncWithCalendar(db, addLocalDays(from, -1), addLocalDays(to, 1), now);
  const sessions = sessionsBetween(db, addLocalDays(from, -1), addLocalDays(to, 1));
  const kept = sessions.filter((session) => session.status === "approved" || session.status === "done");
  const calendar = weekCalendar(db, addLocalDays(from, -1), addLocalDays(to, 1), sessions, now);
  return { sessions, kept, calendar, busy: busyFor(calendar, kept) };
}

/** Reads the model's reply. Anything that isn't a clear session is left out and counted. */
export function parseCandidates(raw: string, methodIds: ReadonlySet<string>): { candidates: Candidate[]; unreadable: number } {
  let value: unknown;
  try { value = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")); }
  catch { return { candidates: [], unreadable: 1 }; }
  const list = Array.isArray(value) ? value : Array.isArray((value as { sessions?: unknown })?.sessions) ? (value as { sessions: unknown[] }).sessions : null;
  if (!list) return { candidates: [], unreadable: 1 };
  const candidates: Candidate[] = [];
  let unreadable = 0;
  for (const entry of list.slice(0, 14)) {
    const item = entry as Record<string, unknown>;
    const discipline = typeof item.discipline === "string" ? item.discipline.toLowerCase().trim() : "";
    const date = typeof item.date === "string" ? item.date : "";
    const start = typeof item.start === "string" ? item.start.trim() : "";
    const minutes = typeof item.minutes === "number" ? Math.round(item.minutes) : NaN;
    const title = typeof item.title === "string" ? clean(item.title, 120) : "";
    if (!(DISCIPLINES as readonly string[]).includes(discipline) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(start)
      || !Number.isFinite(minutes) || !title) { unreadable += 1; continue; }
    const [hour, minute] = start.split(":").map(Number) as [number, number];
    if (hour > 23 || minute > 59) { unreadable += 1; continue; }
    const plan: PlanBlock[] = (Array.isArray(item.plan) ? item.plan : []).slice(0, 12).flatMap((block: unknown) => {
      const b = block as Record<string, unknown>;
      const text = typeof b?.text === "string" ? clean(b.text, 160) : "";
      if (!text) return [];
      const methodId = typeof b.method_id === "string" && methodIds.has(b.method_id) ? b.method_id : null;
      return [{ text, minutes: typeof b.minutes === "number" && b.minutes > 0 ? Math.round(b.minutes) : null, methodId }];
    });
    candidates.push({
      discipline: discipline as Discipline, localDate: date,
      startLocalTime: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`,
      durationMin: minutes, title, plan, reason: typeof item.reason === "string" ? clean(item.reason, 240) : "",
      claimedHard: item.hard === true,
    });
  }
  return { candidates, unreadable };
}

/** Searches AVA's memory for anything about Sir's regular training. */
export function routineFromMemory(archive: MemoryArchive | undefined): () => string[] {
  return () => {
    if (!archive) return [];
    try {
      return archive.search("training gym jiu-jitsu jujitsu bjj boxing kickboxing mma running run mobility class routine", { limit: 6 })
        .map((hit) => clean(hit.record.text, 240));
    } catch { return []; }
  };
}

function logLine(session: TrainingSession): string {
  return `${dayLabel(session.localDate)}: ${DISCIPLINE_LABEL[session.discipline]}, ${session.minutes ?? "?"} min`
    + `${session.effort ? `, effort ${session.effort}` : ""}${session.sore.length ? `, sore: ${session.sore.join(", ")}` : ""}${session.notes ? ` (“${session.notes.slice(0, 80)}”)` : ""}`;
}

export async function planWeek(deps: PlannerDeps, opts: { from?: string } = {}): Promise<PlanResult> {
  const { db, provider } = deps;
  const now = (deps.now ?? Date.now)();
  const { localDate: today, minutes } = localNow(now);
  const from = opts.from ? mondayOf(opts.from) : planningMonday(today), to = addLocalDays(from, 6);
  if (to < today) throw new TrainingError("invalid", "That week is over.");
  const open = { from: from > today ? from : today, to };

  const { sessions, kept, calendar, busy } = fixedAround(db, from, to, now);
  const checkin = getCheckin(db, today);
  const logs = sessionsBetween(db, addLocalDays(today, -14), today).filter((session) => session.status === "done");
  const methods = db.prepare("SELECT id, name, discipline, test_plan FROM training_methods WHERE status = 'testing' ORDER BY updated_at DESC LIMIT 8")
    .all() as Array<{ id: string; name: string; discipline: string; test_plan: string }>;
  const routine = deps.routine?.() ?? [];

  const days: string[] = [];
  for (let date = from; date <= to; date = addLocalDays(date, 1)) {
    const entries = calendar.filter((item) => item.localDate === date).map((item) => {
      const session = item.sessionId ? sessions.find((entry) => entry.id === item.sessionId) : undefined;
      const what = session ? `training ${session.status === "done" ? "done" : "approved"}: ${session.discipline}`
        : item.kind === "booked" ? `training booked: ${item.discipline}` : item.occurrence.kind;
      return `${item.start}–${item.end} ${item.title} (${what})`;
    });
    const unscheduled = kept.filter((session) => session.localDate === date && !session.calendarEventId)
      .map((session) => `${timeRange(session) ?? "time not given"} ${session.title} (training done: ${session.discipline})`);
    const skipped = sessions.filter((session) => session.localDate === date && session.status === "skipped").map((session) => `skipped: ${session.title}`);
    days.push(`${dayLabel(date)} ${date}${date < open.from ? " (past)" : ""}: ${[...entries, ...unscheduled, ...skipped].join("; ") || "free"}`);
  }

  const user = [
    `Now: ${dayLabel(today)} ${today}, ${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")} (Europe/Dublin).`,
    `Week: ${dayLabel(from)} to ${dayLabel(to)}. Open for planning: ${open.from} to ${open.to}.`,
    `Calendar and training by day:\n${days.join("\n")}`,
    `Last 14 days of logged training:\n${logs.length ? logs.map(logLine).join("\n") : "none logged"}`,
    `Today's check-in: ${checkin ? `${checkin.feeling}${checkin.sore.length ? `, sore: ${checkin.sore.join(", ")}` : ""}${checkin.sleepHours !== null ? `, slept ${checkin.sleepHours} h` : ""}${checkin.note ? ` (“${checkin.note}”)` : ""}` : "none yet"}`,
    methods.length ? `Methods being tested:\n${methods.map((method) => `- ${method.id} | ${method.discipline} | ${method.name}${method.test_plan ? ` | test: ${method.test_plan.slice(0, 160)}` : ""}`).join("\n")}` : "",
    routine.length ? `What AVA remembers about his routine:\n${routine.map((line) => `- ${line}`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");

  const raw = await provider.complete({ model: provider.defaultOrchestratorModel, system: SYSTEM, user, maxTokens: 3_000 });
  const { candidates, unreadable } = parseCandidates(raw, new Set(methods.map((method) => method.id)));
  if (!candidates.length && unreadable) throw new TrainingError("invalid", "The planner's answer couldn't be read. Try again.");
  const checked = validateProposals({
    candidates, busy, week: { from, to }, allowed: open, now: { localDate: today, minutes },
    checkin: checkin ? { localDate: checkin.localDate, feeling: checkin.feeling, sore: checkin.sore } : null,
  });

  // The model took a while: check again against the calendar and sessions as
  // they are now (Sir may have approved or added something meanwhile).
  const later = (deps.now ?? Date.now)();
  const result = db.transaction(() => {
    const replaced = clearProposals(db, open.from, open.to);
    const still = validateProposals({
      candidates: checked.kept, busy: fixedAround(db, from, to, later).busy, week: { from, to }, allowed: open,
      now: localNow(later), checkin: checkin ? { localDate: checkin.localDate, feeling: checkin.feeling, sore: checkin.sore } : null,
    });
    return { replaced, proposed: still.kept.map((candidate) => insertProposal(db, candidate, later)), dropped: still.dropped };
  }).immediate();
  return {
    from, to, proposed: result.proposed, replaced: result.replaced,
    dropped: [
      ...[...checked.dropped, ...result.dropped].map((entry) => ({ title: entry.candidate.title, localDate: entry.candidate.localDate, why: entry.why })),
      ...(unreadable ? [{ title: `${unreadable} unclear ${unreadable === 1 ? "idea" : "ideas"}`, localDate: open.from, why: "couldn't be read" }] : []),
    ],
  };
}

/** The result in words that work spoken or shown. */
export function planText(result: PlanResult): string {
  const lines = result.proposed.map((session) => `- ${dayLabel(session.localDate)} ${timeRange(session)}: ${session.title}. ${session.reason}`);
  return [
    result.proposed.length
      ? `Planned ${result.proposed.length} ${result.proposed.length === 1 ? "session" : "sessions"} for ${dayLabel(result.from)} to ${dayLabel(result.to)}, around the calendar. None is in the calendar yet; each waits for an OK:`
      : `No new sessions fit ${dayLabel(result.from)} to ${dayLabel(result.to)} under the rules.`,
    ...lines,
    result.replaced ? `It replaced ${result.replaced} earlier ${result.replaced === 1 ? "proposal" : "proposals"} that weren't approved.` : "",
    result.dropped.length ? `Dropped because they broke a rule: ${result.dropped.map((entry) => `${entry.title} (${entry.why})`).join("; ")}.` : "",
  ].filter(Boolean).join("\n");
}
