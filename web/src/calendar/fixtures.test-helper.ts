import type { CalendarOccurrence } from "./api.js";
import type { EventDefinition } from "./workspace-api.js";
export const event: EventDefinition = {
  id: "cal_fixture", version: 1, title: "Lecture fixture", description: "A disposable test event", location: "Room 12", kind: "lecture",
  timeZone: "Europe/Dublin", anchorLocalDate: "2030-09-27", startLocalTime: "10:00:00", durationMinutes: 60,
  recurrenceKind: "none", recurrenceUntilDate: null, dstPolicy: "reject", attendanceIntent: "attend", notesFolderId: null,
  archivedAt: null, reminderMinutesBefore: null,
};
export const occurrence: CalendarOccurrence = {
  eventId: event.id, occurrenceKey: `${event.id}:2030-09-27`, originalLocalDate: event.anchorLocalDate,
  localStart: "2030-09-27T10:00:00", localEnd: "2030-09-27T11:00:00",
  startsAt: Date.parse("2030-09-27T09:00:00Z"), endsAt: Date.parse("2030-09-27T10:00:00Z"),
  timeZone: event.timeZone, title: event.title, description: event.description, location: event.location, kind: event.kind,
  attendanceIntent: event.attendanceIntent, attendanceOutcome: "unknown", notesFolderId: null,
  eventVersion: 1, exceptionVersion: null, cancelled: false, moved: false,
};
export const workspace = { fetchedAt: Date.parse("2030-09-27T07:00:00Z"), complete: true as const, events: [event], occurrences: [occurrence] };
