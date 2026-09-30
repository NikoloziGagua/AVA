import { describe, expect, it, vi } from "vitest";
import { openInMemoryDb } from "../state/db.js";
import { createCalendarEvent } from "../calendar/service.js";
import { createNote } from "../state/notes.js";
import { createWatch } from "../state/watches.js";
import type { LLMProvider } from "../orchestrator/llm/types.js";
import { calendarText, createFastLookup, lookupCandidate, parsePlan } from "./fast-lookup.js";

// Wed 30 Sep 2026, 12:00 in Dublin.
const NOW = Date.parse("2026-09-30T11:00:00Z");

function provider(reply: string | Error): LLMProvider & { calls: number } {
  const fake = {
    name: "openai" as const, defaultOrchestratorModel: "big", defaultSideModel: "small", calls: 0,
    stream: async function* () { /* unused */ },
    complete: vi.fn(async () => { fake.calls += 1; if (reply instanceof Error) throw reply; return reply; }),
  };
  return fake as unknown as LLMProvider & { calls: number };
}

function seedWeek() {
  const db = openInMemoryDb();
  const lecture = { kind: "lecture" as const, timeZone: "Europe/Dublin", recurrenceKind: "weekly" as const,
    recurrenceUntilDate: "2027-06-30", source: "ava_chat" as const };
  createCalendarEvent(db, { ...lecture, title: "Agile Software Development", anchorLocalDate: "2026-09-28", startLocalTime: "09:00:00", durationMinutes: 120 }, NOW);
  createCalendarEvent(db, { ...lecture, title: "Data Science", anchorLocalDate: "2026-10-01", startLocalTime: "09:00:00", durationMinutes: 60 }, NOW);
  createCalendarEvent(db, { ...lecture, title: "Concurrent Development", anchorLocalDate: "2026-10-01", startLocalTime: "11:00:00", durationMinutes: 60 }, NOW);
  return db;
}

describe("fast lookups", () => {
  it("lets only read-only questions through the first gate", () => {
    for (const request of ["what's on my calendar this week", "do I have class tomorrow?", "what's in my notes",
      "what are my ideas", "any reminders coming up?", "do you remember my mom's name", "what did we decide about the tyre business"]) {
      expect(lookupCandidate(request), request).toBe(true);
    }
    for (const request of ["add gym to my calendar on Friday", "remind me to call mom at 5", "move my Data Science class",
      "remember my mom's name is Teo", "open my notes", "send Lasha a message", "set a reminder for tomorrow",
      "schedule a meeting with Luka", "what's the weather"]) {
      expect(lookupCandidate(request), request).toBe(false);
    }
  });

  it("accepts only a well-formed, bounded plan", () => {
    expect(parsePlan('{"route":"calendar","from":"2026-09-30","to":"2026-10-04","query":null}')).toEqual({ route: "calendar", from: "2026-09-30", to: "2026-10-04" });
    expect(parsePlan('```json\n{"route":"ideas","from":null,"to":null,"query":null}\n```')).toEqual({ route: "ideas" });
    expect(parsePlan('{"route":"calendar","from":"2026-09-30","to":"2027-03-01","query":null}')).toEqual({ route: "agent" });
    expect(parsePlan('{"route":"calendar","from":"next week","to":null,"query":null}')).toEqual({ route: "agent" });
    expect(parsePlan('{"route":"memory","from":null,"to":null,"query":null}')).toEqual({ route: "agent" });
    expect(parsePlan("sure! here you go")).toEqual({ route: "agent" });
  });

  it("reads the calendar day by day, saying so when a day is empty", () => {
    const text = calendarText(seedWeek(), "2026-09-30", "2026-10-02", NOW);
    expect(text).toContain("Wed 30 Sep to Fri 2 Oct");
    expect(text).toContain("Wed 30 Sep: nothing");
    expect(text).toContain("Thu 1 Oct: 09:00-10:00 Data Science; 11:00-12:00 Concurrent Development");
    expect(text).toContain("Fri 2 Oct: nothing");
  });

  it("answers a week question without the agent, and hands everything else back", async () => {
    const db = seedWeek();
    createNote(db, { content: "Scrum in 100 words", title: "Scrum", kind: "idea" });
    createWatch(db, { prompt: "Call mom", kind: "reminder", runAt: NOW + 3_600_000, timeZone: "Europe/Dublin" });
    const calendar = provider('{"route":"calendar","from":"2026-09-30","to":"2026-10-04","query":null}');
    const lookup = createFastLookup({ db, provider: calendar, now: () => NOW });
    const result = await lookup({ request: "what's on my calendar this week", recent: "" });
    expect(result).toMatchObject({ route: "calendar" });
    expect(result!.text).toContain("Thu 1 Oct: 09:00-10:00 Data Science");
    expect(result!.text).toContain("Sun 4 Oct: nothing");

    const ideas = await createFastLookup({ db, provider: provider('{"route":"ideas","from":null,"to":null,"query":null}'), now: () => NOW })({ request: "what are my ideas", recent: "" });
    expect(ideas!.text).toContain("- Scrum");
    const reminders = await createFastLookup({ db, provider: provider('{"route":"reminders","from":null,"to":null,"query":null}'), now: () => NOW })({ request: "any reminders coming up", recent: "" });
    expect(reminders!.text).toContain("Call mom");

    const unsure = provider('{"route":"agent","from":null,"to":null,"query":null}');
    expect(await createFastLookup({ db, provider: unsure, now: () => NOW })({ request: "what's on this week, and move gym", recent: "" })).toBeNull();
    const write = provider('{"route":"calendar","from":"2026-09-30","to":"2026-09-30","query":null}');
    expect(await createFastLookup({ db, provider: write, now: () => NOW })({ request: "add gym to my calendar today", recent: "" })).toBeNull();
    expect(write.calls).toBe(0);
    expect(await createFastLookup({ db, provider: provider(new Error("offline")), now: () => NOW })({ request: "what's on today", recent: "" })).toBeNull();
  });
});
