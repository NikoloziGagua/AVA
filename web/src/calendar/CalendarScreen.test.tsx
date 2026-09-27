import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ fetch: vi.fn(), save: vi.fn(), update: vi.fn(), notes: vi.fn() }));
vi.mock("./workspace-api.js", () => ({ fetchCalendarWorkspace: api.fetch, saveCalendarEvent: api.save, updateOccurrence: api.update }));
vi.mock("../notes/api.js", () => ({ fetchNotesTree: api.notes }));
vi.mock("../design/metal/Atmosphere.js", () => ({ Atmosphere: () => null }));
vi.mock("../schedule/ScheduleScreen.js", () => ({ ScheduleScreen: () => <h1>Standalone reminders</h1> }));
import { CalendarScreen } from "./CalendarScreen.js";
import { AttendanceEditor, EventEditor } from "./EventEditor.js";
import { event, occurrence, workspace } from "./fixtures.test-helper.js";
import { ApiError } from "../api.js";
beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2030-09-27T07:00:00Z"));
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 0));
  api.fetch.mockReset().mockResolvedValue(workspace); api.save.mockReset().mockResolvedValue(event); api.update.mockReset().mockResolvedValue(undefined);
  api.notes.mockReset().mockResolvedValue({ folders: [{ id: "folder", path: "University / Agile" }] });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("Calendar workspace", () => {
  it("renders real month events and selected-day details, not fabricated sample data", async () => {
    render(<CalendarScreen onOpenTalk={vi.fn()} />);
    await screen.findByText("Updated 08:00 · Dublin time");
    expect(screen.getByRole("group", { name: "Choose a date" }).querySelectorAll("button")).toHaveLength(42);
    fireEvent.click(within(screen.getByRole("complementary", { name: "Selected day" })).getByRole("button", { name: /Lecture fixture/ }));
    expect(screen.getByRole("region", { name: "Event details" }).textContent).toContain("Attendance not recorded");
    expect(screen.getByRole("button", { name: "Edit event series" })).toBeTruthy();
    expect(api.save).not.toHaveBeenCalled();
  });
  it("supports week/day and a chronological accessible alternative", async () => {
    render(<CalendarScreen onOpenTalk={vi.fn()} />); await screen.findByText("Updated 08:00 · Dublin time");
    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    expect(await screen.findByRole("region", { name: /Week time grid/ })).toBeTruthy();
    expect(screen.getByText("Chronological week list")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Day" }));
    expect(await screen.findByRole("region", { name: /Day time grid/ })).toBeTruthy();
    expect(api.update).not.toHaveBeenCalled();
  });
  it("moves date selection with arrow keys and returns focus after cancelling editor", async () => {
    render(<CalendarScreen onOpenTalk={vi.fn()} />); await screen.findByText("Updated 08:00 · Dublin time");
    const day = document.querySelector<HTMLButtonElement>('[data-date="2030-09-27"]')!;
    day.focus(); fireEvent.keyDown(day, { key: "ArrowLeft" });
    await waitFor(() => expect(document.activeElement?.getAttribute("data-date")).toBe("2030-09-26"));
    const create = screen.getByRole("button", { name: "New event" }); create.focus(); fireEvent.click(create);
    await screen.findByRole("dialog"); fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(document.activeElement).toBe(create)); expect(api.save).not.toHaveBeenCalled();
  });
  it("hides stale details on failed revalidation rather than enabling stale edits", async () => {
    render(<CalendarScreen onOpenTalk={vi.fn()} />); await screen.findByText("Updated 08:00 · Dublin time");
    fireEvent.click(within(screen.getByRole("complementary")).getByRole("button", { name: /Lecture fixture/ }));
    api.fetch.mockRejectedValueOnce(new Error("offline")); fireEvent(window, new Event("focus"));
    await screen.findByRole("alert"); expect(screen.queryByRole("button", { name: "Edit event series" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Refresh calendar" })); await screen.findByText("Updated 08:00 · Dublin time");
  });
  it("keeps the same-range snapshot visible but locks edits until refresh finishes", async () => {
    render(<CalendarScreen onOpenTalk={vi.fn()} />); await screen.findByText("Updated 08:00 · Dublin time");
    fireEvent.click(within(screen.getByRole("complementary")).getByRole("button", { name: /Lecture fixture/ }));
    let finish!: (value: typeof workspace) => void;
    api.fetch.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    fireEvent(window, new Event("focus"));
    expect(screen.getByText("Refreshing your calendar…")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Event details" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Edit event series" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Attendance / this occurrence" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finish(workspace));
    expect((screen.getByRole("button", { name: "Edit event series" }) as HTMLButtonElement).disabled).toBe(false);
  });
  it.each(["series", "occurrence"])("closing a stale %s editor reads the latest version before reopening", async kind => {
    render(<CalendarScreen onOpenTalk={vi.fn()} />); await screen.findByText("Updated 08:00 · Dublin time");
    fireEvent.click(within(screen.getByRole("complementary")).getByRole("button", { name: /Lecture fixture/ }));
    const openName = kind === "series" ? "Edit event series" : "Attendance / this occurrence";
    const saveName = kind === "series" ? "Save event" : "Save occurrence";
    const writer = kind === "series" ? api.save : api.update;
    writer.mockRejectedValueOnce(new ApiError(409, "Changed elsewhere", "stale_version", null, ""));
    fireEvent.click(screen.getByRole("button", { name: openName }));
    fireEvent.click(screen.getByRole("button", { name: saveName })); await screen.findByRole("alert");
    api.fetch.mockResolvedValue({ ...workspace, events: [{ ...event, version: 2 }], occurrences: [{ ...occurrence, eventVersion: 2, exceptionVersion: 3 }] });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect((screen.getByRole("button", { name: openName }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: openName }));
    fireEvent.click(screen.getByRole("button", { name: saveName }));
    await waitFor(() => expect(writer).toHaveBeenCalledTimes(2));
    expect(writer.mock.calls[1]![kind === "series" ? 1 : 0]).toMatchObject(kind === "series" ? { version: 2 } : { eventVersion: 2, exceptionVersion: 3 });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await screen.findByText(/Saved to your calendar.*Updated/);
    fireEvent(window, new Event("focus")); await screen.findByText("Updated 08:00 · Dublin time");
    expect(screen.queryByText(/Saved to your calendar/)).toBeNull();
  });
  it("ignores an older range response after navigation", async () => {
    let resolveOld!: (value: typeof workspace) => void;
    api.fetch.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }));
    render(<CalendarScreen onOpenTalk={vi.fn()} />);
    api.fetch.mockResolvedValue({ ...workspace, events: [], occurrences: [] });
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    await screen.findByText("A little open space.");
    await act(async () => resolveOld(workspace));
    expect(screen.queryByText(event.title)).toBeNull();
  });
  it("keeps old standalone reminders reachable without converting them to calendar events", async () => {
    render(<CalendarScreen onOpenTalk={vi.fn()} />); await screen.findByText("Updated 08:00 · Dublin time");
    fireEvent.click(screen.getByRole("button", { name: "Reminders" }));
    await screen.findByRole("heading", { name: "Standalone reminders" });
    fireEvent.click(screen.getByRole("button", { name: "Back to Calendar" }));
    await screen.findByRole("heading", { name: "Room for what matters." });
    expect(api.save).not.toHaveBeenCalled();
  });
});
describe("Open event editor", () => {
  it("submits exact fields only on explicit Save, uses Dublin and blocks double submits", async () => {
    let finish!: (value: typeof event) => void;
    api.save.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const saved = vi.fn(); render(<EventEditor date="2030-09-27" onClose={vi.fn()} onSaved={saved} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Study & questions" } });
    expect(api.save).not.toHaveBeenCalled();
    const form = screen.getByRole("button", { name: "Save event" }).closest("form")!;
    fireEvent.submit(form); fireEvent.submit(form);
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(api.save.mock.calls[0]![0]).toMatchObject({ title: "Study & questions", timeZone: "Europe/Dublin", anchorLocalDate: "2030-09-27", recurrenceUntilDate: null });
    expect(screen.getByText(/Event-linked notifications are not available/)).toBeTruthy();
    await act(async () => finish(event)); expect(saved).toHaveBeenCalledWith("2030-09-27");
  });
  it("validates blank and weekly end dates before issuing a write", async () => {
    render(<EventEditor date="2030-09-27" onClose={vi.fn()} onSaved={vi.fn()} />);
    const form = screen.getByRole("button", { name: "Save event" }).closest("form")!;
    fireEvent.submit(form); expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Give this event a title.");
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Weekly lecture" } });
    fireEvent.change(screen.getByLabelText("Repeats"), { target: { value: "weekly" } }); fireEvent.submit(form);
    expect(api.save).not.toHaveBeenCalled(); expect(screen.getByRole("alert").textContent).toContain("end date");
  });
  it.each([0, 409, 502])("requires refresh on stale/uncertain save %s", async status => {
    api.save.mockRejectedValue(new ApiError(status, "Close and refresh.", "stale_version", null, ""));
    render(<EventEditor date="2030-09-27" base={event} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Save event" })); await screen.findByRole("alert");
    expect((screen.getByRole("button", { name: "Save event" }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.save).toHaveBeenCalledTimes(1);
  });
  it("preserves an unavailable folder and suppresses completion after unmount", async () => {
    api.notes.mockRejectedValue(new Error("offline"));
    let finish!: (value: typeof event) => void; api.save.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const saved = vi.fn(); const rendered = render(<EventEditor date="2030-09-27" base={{ ...event, notesFolderId: "existing" }} onClose={vi.fn()} onSaved={saved} />);
    fireEvent.click(screen.getByRole("button", { name: "Save event" }));
    expect(api.save.mock.calls[0]![0].notesFolderId).toBe("existing");
    rendered.unmount(); await act(async () => finish(event)); expect(saved).not.toHaveBeenCalled();
  });
  it("separates attendance plan from outcome and sends cancellation only when changed", async () => {
    render(<AttendanceEditor occurrence={occurrence} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("My plan"), { target: { value: "skip" } });
    fireEvent.click(screen.getByRole("button", { name: "Save occurrence" }));
    await waitFor(() => expect(api.update).toHaveBeenCalledWith(occurrence, { attendanceIntentOverride: "skip", attendanceOutcome: "unknown" }));
  });
  it("keeps advanced fields collapsed and opens them for invalid weekly input", () => {
    render(<EventEditor date="2030-09-27" onClose={vi.fn()} onSaved={vi.fn()} />);
    const details = screen.getByLabelText("Time zone").closest("details")!;
    expect(details.open).toBe(false);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Lecture" } });
    fireEvent.change(screen.getByLabelText("Repeats"), { target: { value: "weekly" } });
    fireEvent.invalid(screen.getByLabelText("Last date"));
    expect(details.open).toBe(true);
    expect(api.save).not.toHaveBeenCalled();
  });
  it.each(["outcome", "cancel"])("does not pin the inherited plan when only changing %s", async change => {
    render(<AttendanceEditor occurrence={occurrence} onClose={vi.fn()} onSaved={vi.fn()} />);
    if (change === "outcome") fireEvent.change(screen.getByLabelText("What happened"), { target: { value: "attended" } });
    else fireEvent.click(screen.getByLabelText("Cancel only this occurrence"));
    fireEvent.click(screen.getByRole("button", { name: "Save occurrence" }));
    await waitFor(() => expect(api.update).toHaveBeenCalledOnce());
    expect(api.update.mock.calls[0]![1]).not.toHaveProperty("attendanceIntentOverride");
  });
  it("allows an explicit return to series inheritance without inventing an outcome", async () => {
    render(<AttendanceEditor occurrence={{ ...occurrence, attendanceIntent: "skip" }} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("My plan"), { target: { value: "inherit" } });
    fireEvent.click(screen.getByRole("button", { name: "Save occurrence" }));
    await waitFor(() => expect(api.update).toHaveBeenCalledWith(expect.anything(), { attendanceIntentOverride: null, attendanceOutcome: "unknown" }));
  });
});
