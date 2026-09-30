// The rules AVA's training plan must follow (docs/design/ava-training.md).
// Everything here is plain code on purpose: the model proposes, these rules
// decide. A proposal that breaks a rule is dropped with the reason, never
// quietly moved or shortened.

export const DISCIPLINES = ["mobility", "bjj", "boxing", "kickboxing", "mma", "gym", "run"] as const;
export const FEELINGS = ["fresh", "ok", "tired", "sore", "injured"] as const;
export const SESSION_STATUSES = ["proposed", "approved", "done", "skipped"] as const;
export type Discipline = (typeof DISCIPLINES)[number];
export type Feeling = (typeof FEELINGS)[number];
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const DISCIPLINE_LABEL: Record<Discipline, string> = {
  mobility: "Mobility", bjj: "Jiu-jitsu", boxing: "Boxing", kickboxing: "Kickboxing", mma: "MMA", gym: "Gym", run: "Running",
};

export const TIME_ZONE = "Europe/Dublin";
/** Travel time Sir asked for: nothing AVA proposes starts or ends within 30 minutes of anything else. */
export const BUFFER_MIN = 30;
export const DAY_START_MIN = 7 * 60;
export const DAY_END_MIN = 22 * 60;
export const MAX_PROPOSALS = 7;

// Order matters: "Gym / Jujitsu" is jiu-jitsu, "Kickboxing" is not boxing.
const TITLE_RULES: Array<[RegExp, Discipline]> = [
  [/\b(?:bjj|jiu[\s-]?jitsu|ju[\s-]?jitsu|jujitsu)\b/i, "bjj"],
  [/\bkick[\s-]?boxing\b/i, "kickboxing"],
  [/\bmma\b/i, "mma"],
  [/\bboxing\b/i, "boxing"],
  [/\b(?:run|runs|running)\b/i, "run"],
  [/\b(?:mobility|stretch|stretching)\b/i, "mobility"],
  [/\b(?:gym|training)\b/i, "gym"],
];

/** Training already in the calendar is recognised by its title. Lectures never are. */
export function disciplineFromTitle(title: string): Discipline | null {
  for (const [pattern, discipline] of TITLE_RULES) if (pattern.test(title)) return discipline;
  return null;
}

const FIGHTING = new Set<Discipline>(["boxing", "kickboxing", "mma", "bjj"]);

/**
 * A hard session: fighting with sparring (or a long class, which usually has
 * it), heavy gym, or a long or fast run. `claimed` lets the model mark one
 * hard; it can never mark one easy that the text says is hard.
 */
export function isHard(input: { discipline: Discipline; text: string; durationMin: number | null; claimed?: boolean }): boolean {
  if (input.claimed) return true;
  const text = input.text.toLowerCase(), minutes = input.durationMin ?? 0;
  switch (input.discipline) {
    case "mobility": return false;
    case "gym": return /\b(?:heavy|max|1rm|pr|test)\b/.test(text) || minutes >= 90;
    case "run": return /\b(?:tempo|intervals?|fast|race|sprints?|hills?|threshold|long)\b/.test(text) || /\b(?:1\d|[2-9]\d)\s?km?\b/.test(text) || minutes >= 60;
    default: return /\b(?:spar\w*|live rounds?|competition)\b/.test(text)
      // In jiu-jitsu and MMA "rolls" are sparring; in boxing a slip-roll is a defence.
      || (input.discipline === "bjj" || input.discipline === "mma") && /\b(?:rolls|rolling)\b/.test(text)
      || minutes >= 90;
  }
}

export type BodyArea = "upper" | "lower";

/** The body areas a session loads. Mobility loads none. */
export function bodyAreas(discipline: Discipline, text: string): BodyArea[] {
  if (discipline === "mobility") return [];
  if (discipline === "boxing") return ["upper"];
  if (discipline === "run") return ["lower"];
  if (FIGHTING.has(discipline)) return ["upper", "lower"];
  const lower = /\b(?:squats?|deadlifts?|hinge|legs?|lunges?|lower)\b/i.test(text);
  const upper = /\b(?:press|bench|pull\w*|rows?|chin\w*|upper|arms?)\b/i.test(text);
  return lower === upper ? ["upper", "lower"] : lower ? ["lower"] : ["upper"];
}

const UPPER_SORE = /shoulder|hand|wrist|elbow|neck|arm|finger|chest|rib/;
const LOWER_SORE = /knee|ankle|hip|foot|feet|calf|calves|hamstring|quad|shin|groin|leg/;

/** Which areas a sore or injured spot rules out. A back, or anything unknown, rules out both. */
export function blockedAreas(sore: readonly string[]): Set<BodyArea> {
  const out = new Set<BodyArea>();
  for (const spot of sore.map((value) => value.toLowerCase())) {
    const upper = UPPER_SORE.test(spot), lower = LOWER_SORE.test(spot);
    if (upper) out.add("upper");
    if (lower) out.add("lower");
    if (!upper && !lower) { out.add("upper"); out.add("lower"); }
  }
  return out;
}

const READINESS_BASE: Record<Feeling, number> = { fresh: 90, ok: 70, tired: 50, sore: 50, injured: 20 };
const FEELING_WORD: Record<Feeling, string> = { fresh: "Fresh", ok: "OK", tired: "Tired", sore: "Sore", injured: "Injured" };

/** A simple score Sir can check by hand: the feeling's number, minus 10 for under 6 hours of sleep. */
export function readiness(checkin: { feeling: Feeling; sleepHours: number | null; sore: readonly string[] } | null): { score: number; word: string; detail: string } | null {
  if (!checkin) return null;
  const short = checkin.sleepHours !== null && checkin.sleepHours < 6;
  const score = READINESS_BASE[checkin.feeling] - (short ? 10 : 0);
  const detail = [
    checkin.sleepHours !== null ? `Slept ${Number.isInteger(checkin.sleepHours) ? checkin.sleepHours : checkin.sleepHours.toFixed(1)} h` : "",
    checkin.sore.length ? `${checkin.sore.join(", ")} sore` : "",
  ].filter(Boolean).join(" · ");
  return { score, word: FEELING_WORD[checkin.feeling], detail };
}

// ---- Proposal validation --------------------------------------------------

export type PlanBlock = { text: string; minutes: number | null; methodId: string | null };

export type Candidate = {
  discipline: Discipline;
  localDate: string;
  /** HH:MM:SS, Europe/Dublin. */
  startLocalTime: string;
  durationMin: number;
  title: string;
  plan: PlanBlock[];
  reason: string;
  claimedHard?: boolean;
};

/** Something already on a day: a calendar entry, booked training, or an approved or done session. */
export type Busy = {
  localDate: string; startMin: number; endMin: number; title: string;
  training?: { discipline: Discipline; hard: boolean; areas: BodyArea[] };
};

export type Dropped = { candidate: Candidate; why: string };

export const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
export const clock = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const candidateText = (candidate: Candidate) => `${candidate.title} ${candidate.plan.map((block) => block.text).join(" ")}`;
const hardOf = (candidate: Candidate) => isHard({ discipline: candidate.discipline, text: candidateText(candidate), durationMin: candidate.durationMin, claimed: candidate.claimedHard });

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const clashes = (a: { startMin: number; endMin: number }, b: { startMin: number; endMin: number }, buffer: number) =>
  a.startMin < b.endMin + buffer && a.endMin + buffer > b.startMin;

/**
 * Keeps the proposals that follow every rule and drops the rest, each with a
 * one-line reason. Nothing is adjusted.
 */
export function validateProposals(input: {
  candidates: Candidate[];
  /** Everything already on the days: calendar entries (with booked training) and approved or done sessions. */
  busy: Busy[];
  /** The whole Monday-to-Sunday week, for the rest-day rule. */
  week: { from: string; to: string };
  /** Dates proposals may fall on (today onwards, inside the week). */
  allowed: { from: string; to: string };
  now: { localDate: string; minutes: number };
  checkin: { localDate: string; feeling: Feeling; sore: string[] } | null;
}): { kept: Candidate[]; dropped: Dropped[] } {
  const dropped: Dropped[] = [];
  const kept: Candidate[] = [];
  const drop = (candidate: Candidate, why: string) => { dropped.push({ candidate, why }); };
  const today = input.now.localDate;
  const checkin = input.checkin && input.checkin.localDate === today ? input.checkin : null;
  const lightUntil = checkin && (checkin.feeling === "sore" || checkin.feeling === "injured") ? addDays(today, 2) : null;
  const blocked = checkin && (checkin.feeling === "sore" || checkin.feeling === "injured") ? blockedAreas(checkin.sore) : new Set<BodyArea>();
  const injuredAnywhere = checkin?.feeling === "injured";
  if (injuredAnywhere && !checkin!.sore.length) { blocked.add("upper"); blocked.add("lower"); }

  const hardOn = (date: string) => [
    ...input.busy.filter((item) => item.localDate === date && item.training?.hard).map((item) => item.training!.areas),
    ...kept.filter((candidate) => candidate.localDate === date && hardOf(candidate)).map((candidate) => bodyAreas(candidate.discipline, candidateText(candidate))),
  ];

  const ordered = [...input.candidates].sort((a, b) => a.localDate.localeCompare(b.localDate) || a.startLocalTime.localeCompare(b.startLocalTime));
  for (const candidate of ordered) {
    if (!(DISCIPLINES as readonly string[]).includes(candidate.discipline)) { drop(candidate, "not one of the disciplines"); continue; }
    if (candidate.localDate < input.allowed.from || candidate.localDate > input.allowed.to) { drop(candidate, "outside the days being planned"); continue; }
    if (!/^\d{2}:\d{2}:\d{2}$/.test(candidate.startLocalTime) || !Number.isInteger(candidate.durationMin) || candidate.durationMin < 10 || candidate.durationMin > 180) {
      drop(candidate, "no clear time or length"); continue;
    }
    const slot = { startMin: minutesOf(candidate.startLocalTime), endMin: minutesOf(candidate.startLocalTime) + candidate.durationMin };
    if (slot.startMin < DAY_START_MIN || slot.endMin > DAY_END_MIN) { drop(candidate, "outside 07:00 to 22:00"); continue; }
    if (candidate.localDate === today && slot.startMin <= input.now.minutes + BUFFER_MIN) { drop(candidate, "too soon or already past"); continue; }
    const busy = input.busy.find((item) => item.localDate === candidate.localDate && clashes(slot, item, BUFFER_MIN));
    if (busy) { drop(candidate, `too close to ${busy.title} (${clock(busy.startMin)}–${clock(busy.endMin)})`); continue; }
    const other = kept.find((item) => item.localDate === candidate.localDate
      && clashes(slot, { startMin: minutesOf(item.startLocalTime), endMin: minutesOf(item.startLocalTime) + item.durationMin }, BUFFER_MIN));
    if (other) { drop(candidate, `too close to another proposal (${other.title})`); continue; }
    const hard = hardOf(candidate), areas = bodyAreas(candidate.discipline, candidateText(candidate));
    const within = (date: string) => lightUntil !== null && date >= today && date <= lightUntil;
    if (hard && within(candidate.localDate)) { drop(candidate, `too hard while you're ${checkin!.feeling}`); continue; }
    if ((within(candidate.localDate) || injuredAnywhere) && areas.some((area) => blocked.has(area))) {
      drop(candidate, `works the ${checkin!.sore.length ? checkin!.sore.join(" and ") : "injured area"}`); continue;
    }
    if (hard && hardOn(candidate.localDate).length) { drop(candidate, "a second hard session that day"); continue; }
    if (hard) {
      const near = [...hardOn(addDays(candidate.localDate, -1)), ...hardOn(addDays(candidate.localDate, 1))];
      if (near.some((other) => other.some((area) => areas.includes(area)))) { drop(candidate, "hard on the same body two days running"); continue; }
    }
    if (kept.length >= MAX_PROPOSALS) { drop(candidate, `more than ${MAX_PROPOSALS} sessions`); continue; }
    kept.push(candidate);
  }

  // At least one rest or mobility day in the week. If AVA's own proposals fill
  // the last free day, the lightest such day's proposals are dropped.
  const trainsOn = (date: string, pool: Candidate[]) =>
    input.busy.some((item) => item.localDate === date && item.training && item.training.discipline !== "mobility")
    || pool.some((candidate) => candidate.localDate === date && candidate.discipline !== "mobility");
  const dates: string[] = [];
  for (let date = input.week.from; date <= input.week.to; date = addDays(date, 1)) dates.push(date);
  if (dates.every((date) => trainsOn(date, kept))) {
    const freeable = dates
      .filter((date) => !trainsOn(date, []))
      .map((date) => ({ date, minutes: kept.filter((candidate) => candidate.localDate === date && candidate.discipline !== "mobility").reduce((sum, candidate) => sum + candidate.durationMin, 0) }))
      .sort((a, b) => a.minutes - b.minutes);
    const rest = freeable[0];
    if (rest) {
      for (const candidate of kept.filter((item) => item.localDate === rest.date && item.discipline !== "mobility")) {
        kept.splice(kept.indexOf(candidate), 1);
        drop(candidate, "keeps one rest day in the week");
      }
    }
  }
  return { kept, dropped };
}
