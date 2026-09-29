import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { endSeries, extendSeries, fetchCalendarWorkspace, removeEvent, restoreEvent, saveCalendarEvent, updateOccurrence } from "./workspace-api.js";
import { event, occurrence, workspace } from "./fixtures.test-helper.js";
const fetcher = vi.fn();
vi.mock("../auth/tokens.js", () => ({ getToken: () => "fixture-only-token", clearToken: vi.fn() }));
beforeEach(() => { fetcher.mockReset(); vi.stubGlobal("fetch", fetcher); });
afterEach(() => vi.unstubAllGlobals());
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
describe("Existing authenticated calendar contract", () => {
  it("loads complete correlated authoritative evidence with auth", async () => {
    fetcher.mockResolvedValue(response(workspace));
    expect(await fetchCalendarWorkspace(100, 200, "Europe/Dublin")).toEqual(workspace);
    expect(fetcher.mock.calls[0]![0]).toContain("timeZone=Europe%2FDublin");
    expect(fetcher.mock.calls[0]![1].headers.get("authorization")).toBe("Bearer fixture-only-token");
  });
  it.each([
    { ...workspace, complete: false }, { ...workspace, events: [] },
    { ...workspace, events: [event, event] }, { ...workspace, occurrences: [occurrence, occurrence] },
    { ...workspace, occurrences: [{ ...occurrence, eventVersion: 2 }] },
    { ...workspace, occurrences: [{ ...occurrence, occurrenceKey: "wrong" }] },
    { ...workspace, events: [{ ...event, timeZone: "bogus" }] },
    { ...workspace, events: [{ ...event, anchorLocalDate: "2030-02-31" }] },
    { ...workspace, occurrences: [{ ...occurrence, attendanceIntent: "pretend" }] },
  ])("rejects malformed, stale, duplicate or partial data", async body => {
    fetcher.mockResolvedValue(response(body));
    await expect(fetchCalendarWorkspace(100, 200, "Europe/Dublin")).rejects.toMatchObject({ status: 502 });
  });
  it("creates once and edits with expectedVersion without replay", async () => {
    fetcher.mockResolvedValueOnce(response({ event })).mockResolvedValueOnce(response({ event: { ...event, version: 2 } }));
    await saveCalendarEvent(event); await saveCalendarEvent(event, event);
    expect(fetcher.mock.calls.map(call => call[1].method)).toEqual(["POST", "PATCH"]);
    expect(JSON.parse(fetcher.mock.calls[1]![1].body).expectedVersion).toBe(1);
  });
  it("rejects a wrong-identity or non-advanced edit receipt", async () => {
    fetcher.mockResolvedValueOnce(response({ event: { ...event, id: "cal_other", version: 2 } })).mockResolvedValueOnce(response({ event }));
    await expect(saveCalendarEvent(event, event)).rejects.toMatchObject({ status: 502 });
    await expect(saveCalendarEvent(event, event)).rejects.toMatchObject({ status: 502 });
  });
  it("sends exact occurrence identity and both concurrency guards", async () => {
    fetcher.mockResolvedValue(response({ exception: { eventId: event.id, occurrenceLocalDate: occurrence.originalLocalDate, version: 1 } }));
    await updateOccurrence(occurrence, { attendanceOutcome: "attended" });
    expect(fetcher.mock.calls[0]![0]).toBe("/api/calendar/events/cal_fixture/occurrences/2030-09-27");
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({ attendanceOutcome: "attended", expectedEventVersion: 1, expectedExceptionVersion: null });
  });
  it("uses bounded error copy and does not retry unknown outcomes", async () => {
    fetcher.mockResolvedValueOnce(response({ error: "stale_version", message: "DO NOT DISPLAY secret" }, 409));
    await expect(saveCalendarEvent(event, event)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("changed elsewhere") });
    fetcher.mockRejectedValueOnce(new Error("secret payload"));
    await expect(saveCalendarEvent(event)).rejects.toMatchObject({ status: 0, message: expect.stringContaining("unconfirmed") });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("passes an explicit null inheritance reset through the existing contract", async () => {
    fetcher.mockResolvedValue(response({ exception: { eventId: event.id, occurrenceLocalDate: occurrence.originalLocalDate, version: 1 } }));
    await updateOccurrence(occurrence, { attendanceIntentOverride: null });
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({ attendanceIntentOverride: null, expectedEventVersion: 1, expectedExceptionVersion: null });
  });
  it("does not issue a mutation for malformed identity", async () => {
    await expect(saveCalendarEvent(event, { ...event, id: "../secret" })).rejects.toThrow("identity");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("calendar-events v3 client", () => {
  const weeklyEvent = { ...event, recurrenceKind: "weekly" as const, recurrenceUntilDate: "2030-12-27" };
  it("accepts a real no-op edit (changed:false, same version) and rejects an inconsistent one", async () => {
    fetcher.mockResolvedValueOnce(response({ event, changed: false })).mockResolvedValueOnce(response({ event: { ...event, version: 2 }, changed: false }));
    expect(await saveCalendarEvent(event, event)).toEqual(event);
    await expect(saveCalendarEvent(event, event)).rejects.toMatchObject({ status: 502 });
  });
  it("accepts a no-op occurrence update only for a matching row or an expected missing one", async () => {
    const withRow = { ...occurrence, exceptionVersion: 4 };
    fetcher.mockResolvedValueOnce(response({ exception: null, changed: false }))
      .mockResolvedValueOnce(response({ exception: null, changed: false }))
      .mockResolvedValueOnce(response({ exception: { eventId: event.id, occurrenceLocalDate: occurrence.originalLocalDate, version: 4 }, changed: false }))
      .mockResolvedValueOnce(response({ exception: { eventId: event.id, occurrenceLocalDate: occurrence.originalLocalDate, version: 5 }, changed: false }));
    await expect(updateOccurrence(occurrence, { attendanceOutcome: "unknown" })).resolves.toBeUndefined();
    await expect(updateOccurrence(withRow, { attendanceOutcome: "unknown" })).rejects.toMatchObject({ status: 502 });
    await expect(updateOccurrence(withRow, { attendanceOutcome: "unknown" })).resolves.toBeUndefined();
    await expect(updateOccurrence(withRow, { attendanceOutcome: "unknown" })).rejects.toMatchObject({ status: 502 });
  });
  it("ends, extends, removes and restores with the exact guarded requests", async () => {
    const ended = { ...weeklyEvent, version: 2, recurrenceUntilDate: "2030-10-04" };
    const removed = { ...weeklyEvent, version: 2, archivedAt: 5 };
    fetcher.mockResolvedValueOnce(response({ event: ended, endedFromOriginalDate: "2030-10-11", previousRecurrenceUntilDate: "2030-12-27" }))
      .mockResolvedValueOnce(response({ event: { ...weeklyEvent, version: 3 }, previousRecurrenceUntilDate: "2030-10-04" }))
      .mockResolvedValueOnce(response({ event: removed }))
      .mockResolvedValueOnce(response({ event: { ...weeklyEvent, version: 3 } }));
    const done = await endSeries(weeklyEvent, "2030-10-11");
    expect(done.previousRecurrenceUntilDate).toBe("2030-12-27");
    await extendSeries(ended, "2030-12-27");
    await removeEvent(weeklyEvent, true);
    await restoreEvent(removed);
    const calls = fetcher.mock.calls.map(([url, init]) => [init.method, url, init.body ? JSON.parse(init.body) : null]);
    expect(calls).toEqual([
      ["POST", "/api/calendar/events/cal_fixture/end", { expectedVersion: 1, fromOriginalDate: "2030-10-11" }],
      ["POST", "/api/calendar/events/cal_fixture/extend", { expectedVersion: 2, recurrenceUntilDate: "2030-12-27" }],
      ["DELETE", "/api/calendar/events/cal_fixture?expectedVersion=1&includeHistory=true", null],
      ["POST", "/api/calendar/events/cal_fixture/restore", { expectedVersion: 2 }],
    ]);
  });
  it("omits includeHistory when the series hasn't started, and rejects an unconfirmed removal", async () => {
    fetcher.mockResolvedValueOnce(response({ event: { ...weeklyEvent, version: 2, archivedAt: 5 } })).mockResolvedValueOnce(response({ event: { ...weeklyEvent, version: 2 } }));
    await removeEvent(weeklyEvent, false);
    expect(fetcher.mock.calls[0]![0]).toBe("/api/calendar/events/cal_fixture?expectedVersion=1");
    await expect(removeEvent(weeklyEvent, false)).rejects.toMatchObject({ status: 502 });
  });
  it("shows specific copy for the new refusals", async () => {
    fetcher.mockResolvedValueOnce(response({ error: "history_conflict" }, 400));
    await expect(endSeries(weeklyEvent, "2030-10-11")).rejects.toMatchObject({ status: 400, message: expect.stringContaining("Choose a later occurrence") });
  });
});
