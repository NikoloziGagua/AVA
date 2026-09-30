// calendar-events v3 UI: End series from here, Remove, and their versioned Undo.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ fetch: vi.fn(), end: vi.fn(), extend: vi.fn(), remove: vi.fn(), restore: vi.fn() }));
vi.mock("./workspace-api.js", () => ({
  fetchCalendarWorkspace: api.fetch, saveCalendarEvent: vi.fn(), updateOccurrence: vi.fn(),
  endSeries: api.end, extendSeries: api.extend, removeEvent: api.remove, restoreEvent: api.restore,
}));
vi.mock("../notes/api.js", () => ({ fetchNotesTree: vi.fn().mockResolvedValue({ folders: [] }) }));
vi.mock("../design/metal/Atmosphere.js", () => ({ Atmosphere: () => null }));
vi.mock("../schedule/ScheduleScreen.js", () => ({ ScheduleScreen: () => null }));
import { CalendarScreen } from "./CalendarScreen.js";
import { event, occurrence } from "./fixtures.test-helper.js";
import { ApiError } from "../api.js";

const KEY = "cal_fixture:2030-10-04";
const weekly = (anchor: string) => ({ ...event, anchorLocalDate: anchor, recurrenceKind: "weekly" as const, recurrenceUntilDate: "2030-12-27" });
const later = { ...occurrence, occurrenceKey: KEY, originalLocalDate: "2030-10-04", localStart: "2030-10-04T10:00:00", localEnd: "2030-10-04T11:00:00",
  startsAt: Date.parse("2030-10-04T09:00:00Z"), endsAt: Date.parse("2030-10-04T10:00:00Z") };
const workspaceOf = (definition: typeof event) => ({ fetchedAt: Date.parse("2030-09-27T07:00:00Z"), complete: true as const, events: [definition], occurrences: [later] });
async function open(definition: typeof event) {
  api.fetch.mockResolvedValue(workspaceOf(definition));
  render(<CalendarScreen onOpenTalk={vi.fn()} focusAt={later.startsAt} focusOccurrenceKey={KEY} />);
  return within(await screen.findByRole("region", { name: "Event details" }));
}

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2030-09-27T07:00:00Z"));
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 0));
  for (const fn of Object.values(api)) fn.mockReset();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Whole series actions", () => {
  it("ends a weekly series from a future occurrence, then undoes it with the returned version", async () => {
    const def = weekly("2030-09-20");
    const ended = { ...def, version: 2, recurrenceUntilDate: "2030-09-27" };
    api.end.mockResolvedValue({ event: ended, previousRecurrenceUntilDate: "2030-12-27" });
    api.extend.mockResolvedValue({ ...ended, version: 3, recurrenceUntilDate: "2030-12-27" });
    const details = await open(def);
    fireEvent.click(details.getByRole("button", { name: "End series from here" }));
    expect(details.getByText(/Earlier ones, and anything you recorded, stay/)).toBeTruthy();
    fireEvent.click(details.getByRole("button", { name: "End series" }));
    await waitFor(() => expect(api.end).toHaveBeenCalledWith(def, "2030-10-04"));
    const bar = await screen.findByText(/Undo is available until you leave this screen/);
    expect(bar.textContent).toContain("ends after");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(api.extend).toHaveBeenCalledWith(ended, "2030-12-27"));
    await screen.findByText(/Back as it was/);
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("removes a started series saying plainly that its past is hidden, and restores it", async () => {
    const def = weekly("2030-09-20"); // first occurrence has already happened
    const removed = { ...def, version: 2, archivedAt: 1 };
    api.remove.mockResolvedValue(removed);
    api.restore.mockResolvedValue({ ...def, version: 3 });
    const details = await open(def);
    fireEvent.click(details.getByRole("button", { name: "Remove series…" }));
    expect(details.getByText(/past occurrences are hidden too/)).toBeTruthy();
    fireEvent.click(details.getByRole("button", { name: "Remove series" }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith(def, true));
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(api.restore).toHaveBeenCalledWith(removed));
  });

  it("removes a series that hasn't started without claiming its past is hidden", async () => {
    const def = weekly("2030-09-27"); // anchor is later today, so nothing has happened
    api.remove.mockResolvedValue({ ...def, version: 2, archivedAt: 1 });
    const details = await open(def);
    fireEvent.click(details.getByRole("button", { name: "Remove series…" }));
    expect(details.queryByText(/past occurrences are hidden/)).toBeNull();
    fireEvent.click(details.getByRole("button", { name: "Remove series" }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith(def, false));
  });

  it("offers Remove but not End for a one-off event", async () => {
    const details = await open({ ...event, anchorLocalDate: "2030-10-04" });
    expect(details.queryByRole("button", { name: "End series from here" })).toBeNull();
    expect(details.getByRole("button", { name: "Remove event…" })).toBeTruthy();
  });

  it("explains a refusal in place and offers no Undo", async () => {
    api.end.mockRejectedValue(new ApiError(400, "That would hide or bring back an occurrence that already happened or was recorded. Choose a later occurrence.", "history_conflict", null, ""));
    const details = await open(weekly("2030-09-20"));
    fireEvent.click(details.getByRole("button", { name: "End series from here" }));
    fireEvent.click(details.getByRole("button", { name: "End series" }));
    expect((await details.findByRole("alert")).textContent).toContain("Choose a later occurrence");
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    fireEvent.click(details.getByRole("button", { name: "Keep it" }));
    expect(details.getByRole("button", { name: "End series from here" })).toBeTruthy();
  });

  it("keeps Undo until dismissed and reports a failed undo without dropping it", async () => {
    const def = weekly("2030-09-20");
    api.end.mockResolvedValue({ event: { ...def, version: 2, recurrenceUntilDate: "2030-09-27" }, previousRecurrenceUntilDate: "2030-12-27" });
    api.extend.mockRejectedValue(new ApiError(409, "This event changed elsewhere.", "stale_version", null, ""));
    const details = await open(def);
    fireEvent.click(details.getByRole("button", { name: "End series from here" }));
    fireEvent.click(details.getByRole("button", { name: "End series" }));
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect((await screen.findAllByRole("alert")).some((node) => node.textContent?.includes("changed elsewhere"))).toBe(true);
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });
});
