import type { Db } from "../state/db.js";
import type { LLMProvider } from "../orchestrator/llm/types.js";
import { queryCalendar } from "../calendar/service.js";
import { addLocalDays, localDayWindow } from "../calendar/time.js";
import { listNoteFolders, listNoteProjects, listNotes, type Note } from "../state/notes.js";
import { listWatches } from "../state/watches.js";
import type { MemoryArchive } from "../memory-archive/archive.js";
import type { MemoryIndexService } from "../memory-index/store.js";
import { formatRecall, recall, recallIdeas } from "../memory-archive/recall.js";
import { memoryV2Enabled } from "../memory-archive/brief.js";
import { fastProjectAction } from "./project-actions.js";
import { fastTrainingAction } from "./training-actions.js";

// The fast lane for read-only questions. A voice question like "what's on this
// week?" used to go through AVA's full agent: a ~23,000-token prompt and two
// rounds of the big model (~16 s each) around a calendar read that takes a few
// milliseconds. Here a small model only decides WHAT to read, AVA reads it
// from its own database, and the verified result goes straight back to be
// spoken. Anything that changes something, or is unclear, returns null and
// takes the normal agent path.

const TIME_ZONE = "Europe/Dublin";
const MAX_RESULT_CHARS = 1_700;
const MAX_CALENDAR_DAYS = 31;

// Requests that change something or need real work are never lookups.
const WRITE_INTENT = /\b(?:add|create|put|move|delete|remove|cancel|change|update|edit|reschedule|book|send|text|message|call|open|search|research|save|write|forward|reply|remind me|set (?:a|an|up|me)|make (?:a|an|me)|schedule (?:a|an|the|me|it))\b|^\s*(?:please\s+)?(?:remember|note)\b|\b(?:remember|note) (?:that|this)\b/i;
// Lookups are about these things; any other request skips the router entirely.
const LOOKUP_TOPICS = /\b(?:calendar|schedule|timetable|agenda|class(?:es)?|lectures?|uni(?:versity)?|today|tonight|tomorrow|week(?:end)?|monday|tuesday|wednesday|thursday|friday|saturday|sunday|free|busy|plans?|coming up|what's on|what is on|notes?|ideas?|reminders?|remember|know about me|what did (?:we|i)|when did|did (?:we|i))\b/i;

/** Cheap first gate: could this be a read-only lookup at all? */
export function lookupCandidate(request: string): boolean {
  return LOOKUP_TOPICS.test(request) && !WRITE_INTENT.test(request);
}

export type LookupPlan =
  | { route: "calendar"; from: string; to: string }
  | { route: "notes"; query: string | null }
  | { route: "ideas" }
  | { route: "reminders" }
  | { route: "memory"; query: string }
  | { route: "agent" };

export type LookupResult = {
  route: Exclude<LookupPlan["route"], "agent"> | "projects" | "training"; text: string; ms: number;
  /** The project the call is now about ("let's talk about the tyre business"). */
  project?: { id: string; name: string };
};

const ROUTER_SYSTEM = `You route one spoken request from Sir (Niko) to AVA. Decide whether it is a READ-ONLY question AVA can answer by reading its own data, and which data:
- calendar: what's on, his schedule, classes, plans or free time in a period. Give "from" and "to" as YYYY-MM-DD in Europe/Dublin, inclusive.
- notes: what is in his notes, or finding one of his notes. "query" = the words to look for, or null for an overview.
- ideas: his saved ideas.
- reminders: his upcoming reminders.
- memory: what AVA knows or remembers about him, or what was said or decided before. "query" = what to look for.
- agent: anything else; anything that adds, changes, removes, sends, opens or researches; anything needing several steps; or if unsure.
Dates: "today" is the current date; "this week" is today through Sunday; "next week" is next Monday through Sunday; a weekday name is the next such day (today if it is today); "this weekend" is Saturday and Sunday.
Reply with JSON only: {"route": "...", "from": "YYYY-MM-DD" or null, "to": "YYYY-MM-DD" or null, "query": string or null}`;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const LABEL = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
const STAMP = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

function dayLabel(localDate: string): string {
  return LABEL.format(new Date(`${localDate}T12:00:00Z`)).replace(",", "").replace("Sept", "Sep");
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

export function parsePlan(raw: string): LookupPlan {
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")) as Record<string, unknown>;
  } catch {
    return { route: "agent" };
  }
  const query = typeof value.query === "string" && value.query.trim() ? value.query.trim().slice(0, 200) : null;
  switch (value.route) {
    case "calendar": {
      const from = typeof value.from === "string" && DAY.test(value.from) ? value.from : null;
      const to = typeof value.to === "string" && DAY.test(value.to) ? value.to : from;
      if (!from || !to) return { route: "agent" };
      const span = daysBetween(from, to);
      return span >= 0 && span < MAX_CALENDAR_DAYS ? { route: "calendar", from, to } : { route: "agent" };
    }
    case "notes": return { route: "notes", query };
    case "ideas": return { route: "ideas" };
    case "reminders": return { route: "reminders" };
    case "memory": return query ? { route: "memory", query } : { route: "agent" };
    default: return { route: "agent" };
  }
}

function clip(text: string): string {
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS - 40)}\n(more not shown; ask for a shorter period)` : text;
}

export function calendarText(db: Db, from: string, to: string, now: number): string {
  const window = { from: localDayWindow(from, TIME_ZONE).from, to: localDayWindow(to, TIME_ZONE).to };
  const result = queryCalendar(db, window.from, window.to, TIME_ZONE, now);
  const byDay = new Map<string, string[]>();
  for (const occurrence of [...result.occurrences].filter((item) => !item.cancelled).sort((a, b) => a.startsAt - b.startsAt)) {
    const day = occurrence.localStart.slice(0, 10);
    const line = `${occurrence.localStart.slice(11, 16)}-${occurrence.localEnd.slice(11, 16)} ${occurrence.title}`;
    byDay.set(day, [...(byDay.get(day) ?? []), line]);
  }
  const lines: string[] = [];
  for (let day = from; daysBetween(day, to) >= 0; day = addLocalDays(day, 1)) {
    lines.push(`${dayLabel(day)}: ${(byDay.get(day) ?? []).join("; ") || "nothing"}`);
  }
  return clip(`AVA's calendar, read just now (Europe/Dublin times), ${dayLabel(from)} to ${dayLabel(to)}:\n${lines.join("\n")}`);
}

function noteLine(note: Note): string {
  const where = note.folderPath.map((crumb) => crumb.name).join(" / ") || "General";
  const excerpt = note.content.replace(/\s+/g, " ").trim().slice(0, 90);
  return `- ${note.title || "Untitled"} (${where})${excerpt ? `: ${excerpt}` : ""}`;
}

export function notesText(db: Db, query: string | null): string {
  if (query) {
    const found = listNotes(db, { q: query, limit: 8 }).filter((note) => note.status !== "archived");
    return clip(found.length
      ? `Notes matching "${query}", read just now:\n${found.map(noteLine).join("\n")}`
      : `No notes match "${query}".`);
  }
  // "My notes" means Sir's own notes first; AVA's own project notes are counted separately.
  const avaProjects = new Set(listNoteProjects(db).filter((project) => /^ava\b/i.test(project.name)).map((project) => project.id));
  const all = listNotes(db, { limit: 200 }).filter((note) => note.status !== "archived");
  const own = all.filter((note) => !note.projectId || !avaProjects.has(note.projectId));
  const counts = new Map<string, number>();
  for (const note of own) {
    const where = note.folderPath.map((crumb) => crumb.name).join(" / ") || "General";
    counts.set(where, (counts.get(where) ?? 0) + 1);
  }
  const folders = [...counts.entries()].map(([where, n]) => `${where} (${n})`).join(", ");
  const recent = [...own].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6).map(noteLine);
  return clip([
    `Sir's own notes, read just now: ${own.length} notes${folders ? ` in ${folders}` : ""}. ${all.length - own.length} more are AVA's project notes.`,
    `Folders: ${listNoteFolders(db).length}.`,
    recent.length ? `Most recently changed:\n${recent.join("\n")}` : "",
  ].filter(Boolean).join("\n"));
}

export function ideasText(db: Db): string {
  const ideas = listNotes(db, { kind: "idea", limit: 60 }).filter((note) => note.status !== "archived")
    .sort((a, b) => b.createdAt - a.createdAt);
  return clip(ideas.length
    ? `Sir's saved ideas, read just now (${ideas.length}):\n${ideas.slice(0, 15).map((note) => `- ${note.title || note.content.slice(0, 80)}`).join("\n")}`
    : "Sir has no saved ideas right now.");
}

export function remindersText(db: Db, now: number): string {
  const upcoming = listWatches(db)
    .filter((watch) => watch.kind === "reminder" && watch.enabled && (watch.run_at === null || watch.run_at >= now))
    .sort((a, b) => (a.run_at ?? Number.MAX_SAFE_INTEGER) - (b.run_at ?? Number.MAX_SAFE_INTEGER));
  return clip(upcoming.length
    ? `Sir's upcoming reminders, read just now:\n${upcoming.slice(0, 12).map((watch) => `- ${watch.run_at !== null ? STAMP.format(watch.run_at) : watch.daily_at ? `daily at ${watch.daily_at}` : "repeating"}: ${watch.prompt.slice(0, 100)}`).join("\n")}`
    : "Sir has no upcoming reminders.");
}

export type FastLookup = (input: { request: string; recent: string; signal?: AbortSignal }) => Promise<LookupResult | null>;

/**
 * Builds the fast lane. Returns null (the caller then uses the full agent)
 * whenever the request is not clearly a read-only lookup, the router is
 * unsure, or anything fails.
 */
export function createFastLookup(deps: {
  db: Db;
  provider: LLMProvider;
  archive?: MemoryArchive;
  index?: MemoryIndexService;
  /** What AVA remembers about Sir's training routine, for the planner. */
  routine?: () => string[];
  now?: () => number;
}): FastLookup {
  const now = deps.now ?? Date.now;
  return async ({ request, recent, signal }) => {
    const started = now();
    // Projects first: adding or removing one must never wait for the agent.
    const projectAction = await fastProjectAction(deps, request, recent, signal);
    if (projectAction) return { route: "projects", text: projectAction.text, project: projectAction.project, ms: now() - started };
    // Training next: "did boxing, 60 minutes" is logged in about two seconds.
    const trainingAction = await fastTrainingAction({ db: deps.db, provider: deps.provider, routine: deps.routine, now }, request, recent, signal);
    if (trainingAction) return { route: "training", text: trainingAction.text, ms: now() - started };
    if (!lookupCandidate(request) || signal?.aborted) return null;
    let plan: LookupPlan;
    try {
      plan = parsePlan(await deps.provider.complete({
        model: deps.provider.defaultSideModel,
        system: ROUTER_SYSTEM,
        user: [
          `Now: ${STAMP.format(now())} (Europe/Dublin).`,
          recent ? `Recent conversation:\n${recent.slice(-1_500)}` : "",
          `Request: "${request.slice(0, 600)}"`,
        ].filter(Boolean).join("\n"),
        maxTokens: 120,
      }));
    } catch {
      return null;
    }
    if (signal?.aborted) return null;
    try {
      let text: string;
      switch (plan.route) {
        case "calendar": text = calendarText(deps.db, plan.from, plan.to, now()); break;
        case "notes": text = notesText(deps.db, plan.query); break;
        case "ideas": text = ideasText(deps.db); break;
        case "reminders": text = remindersText(deps.db, now()); break;
        case "memory": {
          if (!deps.archive || !memoryV2Enabled()) return null;
          const ideas = deps.index ? await recallIdeas(deps.index, plan.query) : [];
          text = clip(`From AVA's memory, searched just now:\n${formatRecall(recall(deps.db, deps.archive, plan.query), ideas)}`);
          break;
        }
        default: return null;
      }
      return { route: plan.route, text, ms: now() - started };
    } catch {
      return null;
    }
  };
}
