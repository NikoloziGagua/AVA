import type { Db } from "../state/db.js";
import type { ToolDef } from "./ava-mcp.js";
import type { LLMProvider } from "../orchestrator/llm/types.js";
import { DISCIPLINES, DISCIPLINE_LABEL, FEELINGS, readiness, type Discipline, type Feeling } from "../training/rules.js";
import {
  TrainingError, approveSession, dayLabel, getSession, localNow, logSession, logTraining, planningMonday, saveCheckin, sessionsBetween, skipSaid,
  timeRange, trainingBrief, type TrainingSession, type TrainingSource,
} from "../training/store.js";
import { planText, planWeek } from "../training/planner.js";
import { addLocalDays } from "../calendar/time.js";

const text = (value: unknown) => typeof value === "string" ? value : undefined;
const int = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? Math.round(value) : undefined;
const failure = (error: unknown) => ({ ok: false, text: error instanceof Error ? error.message : String(error) });
const describe = (session: TrainingSession) => `${DISCIPLINE_LABEL[session.discipline]} on ${dayLabel(session.localDate)}${timeRange(session) ? ` ${timeRange(session)}` : ""} (“${session.title}”, ${session.status}) id ${session.id}`;
const strings = (value: unknown) => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : undefined;

/**
 * Sir's training: AVA plans sessions around his calendar, he approves each
 * one (only then does it go in the calendar), and he logs and checks in by
 * voice. There are no targets; sessions are designed with him as he goes.
 */
export function buildTrainingTools(options: {
  db: Db; provider?: LLMProvider | null; routine?: () => string[]; sessionId?: string | null;
  source?: Extract<TrainingSource, "chat" | "voice">;
}): ToolDef[] {
  const { db } = options;
  const source = options.source ?? "chat";
  const calendarSource = source === "voice" ? "ava_voice" : "ava_chat";
  const sessionArg = { type: "string", description: "The session id from training_list." };
  return [
    {
      tool: {
        name: "training_list",
        description: "Read Sir's training for today or this week: sessions (waiting for his OK, in his calendar, done, skipped) with ids and versions, training he booked himself, today's check-in and readiness, and calendar warnings.",
        inputSchema: { type: "object", properties: { range: { type: "string", enum: ["today", "week"] }, from: { type: "string", description: "Any date (YYYY-MM-DD) in another Monday-to-Sunday week." } } },
      },
      run: async (args) => ({ ok: true, text: trainingBrief(db, args.range === "today" ? "today" : "week", { withIds: true, from: text(args.from) }) }),
    },
    {
      tool: {
        name: "training_plan_week",
        description: "Plan Sir's training for the rest of a Monday-to-Sunday week around his calendar, recent logs and today's check-in. It proposes sessions only; nothing goes in the calendar until he approves. Replaces earlier unapproved proposals. Read the result back to him.",
        inputSchema: { type: "object", properties: { from: { type: "string", description: "A date in the week to plan (YYYY-MM-DD). Default: this week (next week on a Sunday)." } } },
      },
      run: async (args) => {
        if (!options.provider) return { ok: false, text: "The planner isn't available right now." };
        try { return { ok: true, text: planText(await planWeek({ db, provider: options.provider, routine: options.routine }, { from: text(args.from) })) }; }
        catch (error) { return failure(error); }
      },
    },
    {
      tool: {
        name: "training_approve",
        description: "Put a proposed session in Sir's calendar, only when he says yes to it. session = an id, or \"all\" for every session still waiting this week.",
        inputSchema: { type: "object", properties: { session: { type: "string", description: "A session id, or \"all\"." } }, required: ["session"] },
      },
      run: async (args) => {
        const ref = text(args.session)?.trim() ?? "";
        if (ref === "all") {
          const today = localNow(Date.now()).localDate;
          const waiting = sessionsBetween(db, today, addLocalDays(planningMonday(today), 6)).filter((session) => session.status === "proposed" && session.startLocalTime);
          const lines: string[] = [];
          for (const session of waiting) {
            try { lines.push(`Added: ${describe(approveSession(db, session.id, { source: calendarSource, sessionId: options.sessionId }))}`); }
            catch (error) { if (!(error instanceof TrainingError)) throw error; lines.push(`Not added: ${describe(session)}: ${error.message}`); }
          }
          return { ok: true, text: lines.length ? lines.join("\n") : "No sessions are waiting this week." };
        }
        try { return { ok: true, text: `In his calendar now: ${describe(approveSession(db, ref, { source: calendarSource, sessionId: options.sessionId }))}` }; }
        catch (error) { return failure(error); }
      },
    },
    {
      tool: {
        name: "training_skip",
        description: "Skip a session when Sir says so. One that is still ahead in his calendar is taken out of the calendar too.",
        inputSchema: { type: "object", properties: { session: sessionArg }, required: ["session"] },
      },
      run: async (args) => {
        try {
          const { session, removed } = skipSaid(db, text(args.session) ?? "");
          return { ok: true, text: `Skipped${removed ? " and taken out of his calendar" : ""}: ${describe(session)}` };
        } catch (error) { return failure(error); }
      },
    },
    {
      tool: {
        name: "training_log",
        description: "Log a session Sir did. Pass session to log a planned one; otherwise today's planned session of that discipline is marked done, or a new done session is added. effort is 1-10, only if he gave it.",
        inputSchema: {
          type: "object",
          properties: {
            session: sessionArg, discipline: { type: "string", enum: [...DISCIPLINES] }, minutes: { type: "number" }, effort: { type: "number" },
            sore: { type: "array", items: { type: "string" } }, notes: { type: "string" }, distance_km: { type: "number" }, duration_s: { type: "number" },
            date: { type: "string", description: "YYYY-MM-DD if it wasn't today." },
          },
        },
      },
      run: async (args) => {
        const log = {
          minutes: int(args.minutes), effort: int(args.effort), sore: strings(args.sore), notes: text(args.notes),
          distanceKm: typeof args.distance_km === "number" ? args.distance_km : undefined, durationS: int(args.duration_s),
        };
        try {
          const id = text(args.session);
          if (id) {
            if (!getSession(db, id)) return { ok: false, text: "No session with that id." };
            return { ok: true, text: `Logged: ${describe(logSession(db, id, log, {}))}` };
          }
          const discipline = text(args.discipline) as Discipline | undefined;
          if (!discipline) return { ok: false, text: "Say which discipline, or pass the session id." };
          const { session, matched } = logTraining(db, { ...log, discipline, localDate: text(args.date), source });
          return { ok: true, text: `Logged (${matched === "planned" ? "the planned session" : matched === "calendar" ? "matched to his calendar" : "a new session"}): ${describe(session)}` };
        } catch (error) { return failure(error); }
      },
    },
    {
      tool: {
        name: "training_checkin",
        description: "Save how Sir feels today (one check-in a day; saying more adds to it). feeling: fresh, ok, tired, sore or injured. Readiness is worked out from it.",
        inputSchema: {
          type: "object",
          properties: { feeling: { type: "string", enum: [...FEELINGS] }, sore: { type: "array", items: { type: "string" } }, sleep_hours: { type: "number" }, note: { type: "string" } },
        },
      },
      run: async (args) => {
        try {
          const checkin = saveCheckin(db, localNow(Date.now()).localDate, {
            ...(text(args.feeling) ? { feeling: args.feeling as Feeling } : {}), ...(strings(args.sore) ? { sore: strings(args.sore) } : {}),
            ...(typeof args.sleep_hours === "number" ? { sleepHours: args.sleep_hours } : {}), ...(text(args.note) ? { note: text(args.note) } : {}),
          });
          const score = readiness(checkin)!;
          return { ok: true, text: `Today's check-in: ${score.word}${score.detail ? ` (${score.detail})` : ""}, readiness ${score.score}.` };
        } catch (error) { return failure(error); }
      },
    },
  ];
}
