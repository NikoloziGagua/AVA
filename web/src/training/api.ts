import { request } from "../api.js";

/** Sir's training (server/src/routes/training.ts). */
export type Discipline = "mobility" | "bjj" | "boxing" | "kickboxing" | "mma" | "gym" | "run";
export type Feeling = "fresh" | "ok" | "tired" | "sore" | "injured";
export type SessionStatus = "proposed" | "approved" | "done" | "skipped";
export type PlanBlock = { text: string; minutes: number | null; methodId: string | null };

export type TrainingSession = {
  id: string; discipline: Discipline; title: string; status: SessionStatus; localDate: string;
  startLocalTime: string | null; durationMin: number | null; plan: PlanBlock[]; reason: string;
  calendarEventId: string | null; calendarEventVersion: number | null;
  minutes: number | null; effort: number | null; sore: string[]; notes: string; distanceKm: number | null; durationS: number | null;
  loggedAt: number | null; source: "app" | "chat" | "voice" | "ava"; version: number; createdAt: number; updatedAt: number;
};

export type WeekItem =
  | { kind: "calendar"; key: string; start: string; end: string; title: string; label: "Lecture" | "Event" | "Block" }
  | { kind: "booked"; key: string; start: string; end: string; title: string; discipline: Discipline; hard: boolean }
  | { kind: "session"; key: string; start: string | null; end: string | null; session: TrainingSession; hard: boolean; conflict: string | null };

export type OccurrenceRef = { occurrenceKey: string; eventVersion: number; exceptionVersion: number | null };
export type WeekWarning = {
  key: string; date: string; discipline: Discipline; title: string; text: string; start: string; end: string;
  fix: { first: OccurrenceRef; second: OccurrenceRef } | null;
};
export type Checkin = { id: string; localDate: string; feeling: Feeling; sore: string[]; sleepHours: number | null; note: string };

export type TrainingWeek = {
  from: string; to: string; today: string; nowMinutes: number;
  days: Array<{ date: string; past: boolean; today: boolean; rest: boolean; items: WeekItem[] }>;
  warnings: WeekWarning[];
  checkin: Checkin | null;
  readiness: { score: number; word: string; detail: string } | null;
  cycle: Array<{ discipline: Discipline; done: number; planned: number }>;
  waiting: number;
  note: string;
  fetchedAt: number;
};

export type PlanResult = {
  from: string; to: string; proposed: TrainingSession[]; replaced: number;
  dropped: Array<{ title: string; localDate: string; why: string }>;
};

export type LogInput = { minutes?: number | null; effort?: number | null; sore?: string[]; notes?: string; distanceKm?: number | null; durationS?: number | null };

const post = (body: unknown = {}): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
const at = (id: string) => `/api/training/sessions/${encodeURIComponent(id)}`;

export const fetchWeek = (from?: string) => request<TrainingWeek>(`/api/training${from ? `?from=${encodeURIComponent(from)}` : ""}`);
export const planWeek = (from?: string) => request<{ result: PlanResult; week: TrainingWeek }>("/api/training/plan", post(from ? { from } : {}));
export const approveSession = (session: TrainingSession) =>
  request<{ session: TrainingSession }>(`${at(session.id)}/approve`, post({ expectedVersion: session.version })).then((body) => body.session);
export const approveAll = (sessions: TrainingSession[]) =>
  request<{ approved: TrainingSession[]; failed: Array<{ id: string; error: string; message: string }> }>("/api/training/approve-all",
    post({ sessions: sessions.map((session) => ({ id: session.id, expectedVersion: session.version })) }));
export const skipSession = (session: TrainingSession) =>
  request<{ session: TrainingSession }>(`${at(session.id)}/skip`, post({ expectedVersion: session.version })).then((body) => body.session);
export const unskipSession = (session: TrainingSession) =>
  request<{ session: TrainingSession }>(`${at(session.id)}/unskip`, post({})).then((body) => body.session);
export const unscheduleSession = (session: TrainingSession) =>
  request<{ session: TrainingSession }>(`${at(session.id)}/unschedule`, post({ expectedVersion: session.version })).then((body) => body.session);
export const logSession = (session: TrainingSession, log: LogInput) =>
  request<{ session: TrainingSession }>(`${at(session.id)}/log`, post({ expectedVersion: session.version, ...log })).then((body) => body.session);
export const logUnplanned = (discipline: Discipline, log: LogInput) =>
  request<{ session: TrainingSession; matched: string }>("/api/training/log", post({ discipline, ...log }));
export const saveCheckin = (date: string, checkin: { feeling?: Feeling; sore?: string[]; sleepHours?: number | null; note?: string }) =>
  request<{ checkin: Checkin }>(`/api/training/checkins/${encodeURIComponent(date)}`, { method: "PUT", body: JSON.stringify(checkin) }).then((body) => body.checkin);
export const mergeEntries = (fix: { first: OccurrenceRef; second: OccurrenceRef }) => request<{ ok: true }>("/api/training/merge", post(fix));
export const askTraining = (text: string) => request<{ handled: boolean; text?: string }>("/api/training/ask", post({ text }));
