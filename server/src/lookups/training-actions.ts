import type { Db } from "../state/db.js";
import type { LLMProvider } from "../orchestrator/llm/types.js";
import { addLocalDays } from "../calendar/time.js";
import { DISCIPLINES, DISCIPLINE_LABEL, FEELINGS, readiness, type Discipline, type Feeling } from "../training/rules.js";
import {
  TrainingError, approveSession, dayLabel, localNow, logTraining, mondayOf, planningMonday, saveCheckin, sessionsBetween, skipSaid,
  timeRange, trainingBrief, type TrainingSession,
} from "../training/store.js";
import { planText, planWeek } from "../training/planner.js";

// The fast lane for Sir's training. "Did boxing, 75 minutes, felt heavy" or
// "I'm tired today" must be recorded at once, not after the full agent's slow
// rounds: a small model picks ONE action, AVA does it directly, and the
// verified result is spoken. Anything else goes to the agent.

// Words that only mean training ("run" alone doesn't: "run the backup").
const TRAINING_WORDS = /\b(?:training|trained|workouts?|work(?:ed)? out|gym|jog(?:ged|ging)?|boxing|boxed|kick ?boxing|mma|bjj|jiu[\s-]?jitsu|ju[\s-]?jitsu|jujitsu|sparr?(?:ed|ing)|lifting|lifted weights|mobility|stretching|stretched|readiness)\b/i;
// Running as a session: "a run", "went for a run", "ran 5k", "did 8 km".
const RUN_WORDS = /\b(?:(?:a|my|the|easy|long|short|morning|evening|tempo) run\b|went (?:for a run|running)|ran (?:\d|a |for \d)|running (?:\d|for \d)|\d+(?:\.\d)?\s?(?:k|km)\b)/i;
// How his body feels today, not how he feels about something.
const BODY_WORDS = /\b(?:i'?m|i am|i feel|feeling|felt)\s+(?:really |so |very |a bit |pretty |quite |super |kind of )?(?:tired|sore|fresh|wrecked|injured|knackered|exhausted|stiff|drained)\b|\bslept\b|\b(?:shoulder|knee|back|ankle|hip|neck|wrist|elbow|hamstring|calf|groin|ribs?)\b[^.?!]{0,20}\b(?:sore|hurts?|injured|tweaked|aching|stiff)\b/i;
const PLAN_WEEK = /\bplan (?:my|the|this|next) (?:\w+ )?week\b/i;
const FOLLOW_UP = /\b(?:add (?:them|it|those|all)|approve|yes|yeah|yep|book (?:them|it)|skip (?:it|that|this|the))\b/i;
const APPROVE_SAID = /\b(?:add|approve|book|yes|yeah|yep|put|go ahead|do it|sure)\b/i;
const SKIP_SAID = /\b(?:skip|drop|not doing|won'?t do|can'?t make|cancel)\b/i;
// "Add gym to my calendar" is a calendar edit for the agent, not a proposal to approve.
const CALENDAR_EDIT = /\b(?:add|put|move|book|schedule|reschedule|cancel|remove|delete)\b[^.?!]*\b(?:calendar|diary)\b/i;

/** AVA just read out training proposals, so a bare "yes, add them" is about those. */
function followsProposals(recent: string): boolean {
  const tail = recent.slice(-800);
  return /\b(?:propos\w+|planned|waiting for (?:an|your) OK|waits for an OK|sessions?)\b/i.test(tail) && (TRAINING_WORDS.test(tail) || RUN_WORDS.test(tail));
}

/** Cheap first gate: clearly about training or how his body feels, or a yes/skip right after AVA read out proposals. */
export function trainingCandidate(request: string, recent: string): boolean {
  if (CALENDAR_EDIT.test(request) && !FOLLOW_UP.test(request)) return false;
  if (TRAINING_WORDS.test(request) || RUN_WORDS.test(request) || BODY_WORDS.test(request) || PLAN_WEEK.test(request)) return true;
  return FOLLOW_UP.test(request) && followsProposals(recent);
}

export type TrainingPlan =
  | { action: "log"; discipline: Discipline; minutes: number | null; effort: number | null; sore: string[]; notes: string; distanceKm: number | null; durationS: number | null; date: string | null }
  | { action: "checkin"; feeling: Feeling | null; sore: string[]; sleepHours: number | null; note: string }
  | { action: "approve" | "skip"; sessionId: string; version: number }
  | { action: "approve_all" }
  | { action: "show"; range: "today" | "week" }
  | { action: "plan" }
  | { action: "agent" };

const SYSTEM = `You turn ONE request from Sir (Niko) about his training into ONE action, or "agent".
Actions:
- log: he says he did a session ("did boxing, 75 minutes, felt heavy, shoulder sore"). "discipline" = mobility, bjj, boxing, kickboxing, mma, gym or run (jiu-jitsu, jujitsu, rolling = bjj; lifting, weights = gym; jog = run; stretching = mobility). "minutes" if he says. "effort" 1-10 only if he gives a number. "notes" = how it went in his words. "sore" = body parts he says are sore. For runs, "distance_km" and "duration_s" if he says. "date" YYYY-MM-DD only if it wasn't today.
- checkin: how he feels today ("I'm tired today", "slept five hours"). "feeling" = fresh, ok, tired, sore or injured; "sore" = body parts; "sleep_hours" if he says; "note" = anything else.
- approve: put ONE waiting session in his calendar. "session_id" from the list.
- approve_all: put all waiting sessions in his calendar ("yes, add them").
- skip: skip ONE session. "session_id" from the list.
- show: what training is on. "range" = today or week.
- plan: plan his week or the rest of it.
- agent: anything else: several actions at once, moving a session, technique questions, or if unsure.
Use "session_id" exactly from the list. Reply with JSON only:
{"action": "...", "session_id": string or null, "discipline": string or null, "minutes": number or null, "effort": number or null, "sore": [strings], "notes": string or null, "distance_km": number or null, "duration_s": number or null, "date": string or null, "feeling": string or null, "sleep_hours": number or null, "note": string or null, "range": string or null}`;

/** The model's pick, checked: ids must be real, and a write must match what Sir actually said. */
export function parseTrainingPlan(raw: string, sessions: ReadonlyMap<string, TrainingSession>, today: string, request = ""): TrainingPlan {
  let value: Record<string, unknown>;
  try { value = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")) as Record<string, unknown>; }
  catch { return { action: "agent" }; }
  const str = (key: string) => typeof value[key] === "string" && (value[key] as string).trim() ? (value[key] as string).trim().slice(0, 500) : null;
  const num = (key: string, min: number, max: number) => typeof value[key] === "number" && value[key] as number >= min && value[key] as number <= max ? value[key] as number : null;
  const sore = Array.isArray(value.sore) ? value.sore.filter((spot): spot is string => typeof spot === "string" && !!spot.trim()).map((spot) => spot.trim().slice(0, 40)).slice(0, 8) : [];
  const id = str("session_id");
  const session = id ? sessions.get(id) : undefined;
  switch (value.action) {
    case "log": {
      const discipline = str("discipline")?.toLowerCase();
      if (!discipline || !(DISCIPLINES as readonly string[]).includes(discipline)) return { action: "agent" };
      const date = str("date");
      if (date && !(/^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today && date >= addLocalDays(today, -14))) return { action: "agent" };
      const effort = num("effort", 1, 10), minutes = num("minutes", 1, 600);
      return {
        action: "log", discipline: discipline as Discipline, minutes: minutes === null ? null : Math.round(minutes), effort: effort === null ? null : Math.round(effort),
        sore, notes: str("notes") ?? "", distanceKm: num("distance_km", 0.1, 200), durationS: num("duration_s", 1, 86_400),
        date: date ?? null,
      };
    }
    case "checkin": {
      const feeling = str("feeling")?.toLowerCase() ?? null;
      // Only words about his body change today's feeling ("I feel good about the pitch" doesn't).
      const known = feeling && (FEELINGS as readonly string[]).includes(feeling) && BODY_WORDS.test(request) ? feeling as Feeling : null;
      const sleepHours = num("sleep_hours", 0, 16);
      if (!known && sleepHours === null && !sore.length) return { action: "agent" };
      return { action: "checkin", feeling: known, sore, sleepHours, note: str("note") ?? "" };
    }
    case "approve": return session?.status === "proposed" && APPROVE_SAID.test(request) ? { action: "approve", sessionId: session.id, version: session.version } : { action: "agent" };
    case "skip": return session && (session.status === "proposed" || session.status === "approved") && SKIP_SAID.test(request)
      ? { action: "skip", sessionId: session.id, version: session.version } : { action: "agent" };
    case "approve_all": return APPROVE_SAID.test(request) ? { action: "approve_all" } : { action: "agent" };
    case "show": return { action: "show", range: str("range") === "today" ? "today" : "week" };
    case "plan": return { action: "plan" };
    default: return { action: "agent" };
  }
}

export type TrainingDeps = { db: Db; provider: LLMProvider; routine?: () => string[]; now?: () => number };

const describe = (session: TrainingSession) => `${DISCIPLINE_LABEL[session.discipline]} on ${dayLabel(session.localDate)}${timeRange(session) ? ` ${timeRange(session)}` : ""} (“${session.title}”)`;

/** Carries out one plan and says what is now true, read back from the database. */
export async function runTrainingPlan(deps: TrainingDeps, plan: Exclude<TrainingPlan, { action: "agent" }>, source: "voice" | "app"): Promise<string> {
  const { db } = deps;
  const now = (deps.now ?? Date.now)();
  const calendarSource = source === "voice" ? "ava_voice" : "ava_chat";
  const done = (text: string) => `Done, and checked just now: ${text}`;
  switch (plan.action) {
    case "show": return trainingBrief(db, plan.range, {}, now);
    case "plan": return planText(await planWeek({ ...deps, now: () => now }));
    case "log": {
      const { session, matched } = logTraining(db, {
        discipline: plan.discipline, localDate: plan.date ?? undefined, minutes: plan.minutes, effort: plan.effort, sore: plan.sore,
        notes: plan.notes, distanceKm: plan.distanceKm, durationS: plan.durationS, source: source === "voice" ? "voice" : "app",
      }, now);
      const facts = [session.minutes ? `${session.minutes} min` : "", session.effort ? `effort ${session.effort}` : "effort not given",
        session.distanceKm ? `${session.distanceKm} km` : "", session.sore.length ? `sore: ${session.sore.join(", ")}` : ""].filter(Boolean).join(", ");
      const how = matched === "planned" ? "It was the planned session, now marked done." : matched === "calendar" ? "Matched to the training in the calendar." : "Added as a new session.";
      return done(`logged ${DISCIPLINE_LABEL[session.discipline]} on ${dayLabel(session.localDate)}: ${facts}. ${how}`);
    }
    case "checkin": {
      const checkin = saveCheckin(db, localNow(now).localDate, {
        ...(plan.feeling ? { feeling: plan.feeling } : {}), ...(plan.sore.length ? { sore: plan.sore } : {}),
        ...(plan.sleepHours !== null ? { sleepHours: plan.sleepHours } : {}), ...(plan.note ? { note: plan.note } : {}),
      }, now);
      const score = readiness(checkin)!;
      const light = checkin.feeling === "sore" || checkin.feeling === "injured"
        ? " The next plan stays light and avoids that area; say \"plan my week\" to replan now." : "";
      return done(`today's check-in is ${score.word}${score.detail ? ` (${score.detail})` : ""}, readiness ${score.score}.${light}`);
    }
    case "approve": return done(`${describe(approveSession(db, plan.sessionId, { expectedVersion: plan.version, source: calendarSource }, now))} is in the calendar.`);
    case "approve_all": {
      const today = localNow(now).localDate;
      const waiting = sessionsBetween(db, today, addLocalDays(planningMonday(today), 6)).filter((session) => session.status === "proposed" && session.startLocalTime);
      if (!waiting.length) return "No sessions are waiting for an OK this week.";
      const added: string[] = [], failed: string[] = [];
      for (const session of waiting) {
        try { added.push(describe(approveSession(db, session.id, { source: calendarSource }, now))); }
        catch (error) { if (!(error instanceof TrainingError)) throw error; failed.push(`${describe(session)}: ${error.message}`); }
      }
      return [
        added.length ? done(`added to the calendar: ${added.join("; ")}.`) : "Nothing was added.",
        failed.length ? `Not added: ${failed.join("; ")}` : "",
      ].filter(Boolean).join("\n");
    }
    case "skip": {
      const { session, removed } = skipSaid(db, plan.sessionId, now, plan.version);
      return done(`${describe(session)} is skipped${removed ? " and taken out of the calendar" : ""}.`);
    }
  }
}

export async function fastTrainingAction(deps: TrainingDeps, request: string, recent: string, signal?: AbortSignal, source: "voice" | "app" = "voice"): Promise<{ text: string } | null> {
  if (!trainingCandidate(request, recent) || signal?.aborted) return null;
  const now = (deps.now ?? Date.now)();
  const { localDate: today } = localNow(now);
  const monday = mondayOf(today);
  const sessions = sessionsBetween(deps.db, monday, addLocalDays(monday, 13)).filter((session) => session.localDate >= today);
  let plan: TrainingPlan;
  try {
    plan = parseTrainingPlan(await deps.provider.complete({
      model: deps.provider.defaultSideModel,
      system: SYSTEM,
      user: [
        `Today: ${dayLabel(today)} ${today} (Europe/Dublin).`,
        `Sessions from today on: ${sessions.length ? sessions.map((session) => `${session.id} | ${session.localDate} ${timeRange(session) ?? ""} | ${session.discipline} | ${session.title} | ${session.status}`).join("; ") : "none"}`,
        recent ? `Recent conversation:\n${recent.slice(-1_200)}` : "",
        `Request: "${request.slice(0, 600)}"`,
      ].filter(Boolean).join("\n"),
      maxTokens: 200,
    }), new Map(sessions.map((session) => [session.id, session])), today, request);
  } catch {
    return null;
  }
  if (plan.action === "agent" || signal?.aborted) return null;
  try {
    return { text: await runTrainingPlan(deps, plan, source) };
  } catch (error) {
    // A refusal is still an answer Sir should hear ("that time now clashes with ...").
    return error instanceof TrainingError ? { text: `Not done: ${error.message}` } : null;
  }
}
