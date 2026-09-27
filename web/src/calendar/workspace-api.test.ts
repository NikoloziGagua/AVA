import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCalendarWorkspace, saveCalendarEvent, updateOccurrence } from "./workspace-api.js";
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
  it("does not issue a mutation for malformed identity", async () => {
    await expect(saveCalendarEvent(event, { ...event, id: "../secret" })).rejects.toThrow("identity");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
