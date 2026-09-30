import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrainingSession, TrainingWeek } from "./api.js";

const mock = vi.hoisted(() => ({
  week: vi.fn(), plan: vi.fn(), approve: vi.fn(), approveAll: vi.fn(), skip: vi.fn(), unschedule: vi.fn(), log: vi.fn(),
  logUnplanned: vi.fn(), checkin: vi.fn(), merge: vi.fn(), ask: vi.fn(), unskip: vi.fn(),
}));
vi.mock("./api.js", () => ({
  fetchWeek: mock.week, planWeek: mock.plan, approveSession: mock.approve, approveAll: mock.approveAll, skipSession: mock.skip,
  unscheduleSession: mock.unschedule, logSession: mock.log, logUnplanned: mock.logUnplanned, saveCheckin: mock.checkin,
  mergeEntries: mock.merge, askTraining: mock.ask, unskipSession: mock.unskip,
}));
vi.mock("../design/metal/Atmosphere.js", () => ({ Atmosphere: () => null }));
import { TrainingScreen } from "./TrainingScreen.js";

const session = (over: Partial<TrainingSession> = {}): TrainingSession => ({
  id: "trs_box", discipline: "boxing", title: "Boxing: pads and bag", status: "proposed", localDate: "2030-10-01", startLocalTime: "18:00:00",
  durationMin: 75, plan: [{ text: "Heavy bag", minutes: 30, methodId: null }], reason: "Free after lectures.", calendarEventId: null, calendarEventVersion: null,
  minutes: null, effort: null, sore: [], notes: "", distanceKm: null, durationS: null, loggedAt: null, source: "ava", version: 1, createdAt: 0, updatedAt: 0, ...over,
});

function week(over: Partial<TrainingWeek> = {}): TrainingWeek {
  const days = ["2030-09-30", "2030-10-01", "2030-10-02", "2030-10-03", "2030-10-04", "2030-10-05", "2030-10-06"].map((date) => ({
    date, past: false, today: date === "2030-09-30", rest: true, items: [] as TrainingWeek["days"][number]["items"],
  }));
  days[1]!.items = [
    { kind: "calendar", key: "cal_a:2030-10-01", start: "09:00", end: "10:00", title: "Test lecture", label: "Lecture" },
    { kind: "session", key: "trs_box", start: "18:00", end: "19:15", session: session(), hard: false, conflict: null },
  ];
  days[1]!.rest = false;
  days[2]!.items = [{ kind: "booked", key: "cal_b:2030-10-02", start: "19:00", end: "21:00", title: "Gym / Jujitsu", discipline: "bjj", hard: true }];
  return {
    from: "2030-09-30", to: "2030-10-06", today: "2030-09-30", nowMinutes: 600, days,
    warnings: [{
      key: "w1", date: "2030-10-03", discipline: "run", title: "Run (two entries, 13:20 and 14:00)", text: "Looks like one run entered twice. Merge them?",
      start: "13:20", end: "14:30", fix: { first: { occurrenceKey: "cal_c:2030-10-03", eventVersion: 1, exceptionVersion: null }, second: { occurrenceKey: "cal_d:2030-10-03", eventVersion: 1, exceptionVersion: null } },
    }],
    checkin: null, readiness: null,
    cycle: [{ discipline: "bjj", done: 0, planned: 1 }, { discipline: "boxing", done: 0, planned: 1 }],
    waiting: 1, note: "No targets.", fetchedAt: 1, ...over,
  };
}

beforeEach(() => {
  for (const fn of Object.values(mock)) fn.mockReset();
  mock.week.mockResolvedValue(week());
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Training tab", () => {
  it("shows the week: lectures, booked training, proposals waiting for an OK, and a calendar warning", async () => {
    render(<TrainingScreen />);
    const thursday = await screen.findByRole("region", { name: "Tue 1 Oct" });
    expect(within(thursday).getByText("Test lecture")).toBeTruthy();
    expect(within(thursday).getByText("Lecture")).toBeTruthy();
    expect(within(thursday).getByText("Free after lectures.")).toBeTruthy();
    expect(screen.getByText("Gym / Jujitsu")).toBeTruthy();
    expect(screen.getByText(/1 session waiting for your OK/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Approve all 1/ })).toBeTruthy();

    mock.merge.mockResolvedValue({ ok: true });
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    await waitFor(() => expect(mock.merge).toHaveBeenCalledWith(week().warnings[0]!.fix));
  });

  it("adds or skips a proposal, and only on his tap", async () => {
    render(<TrainingScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Add" }));
    await waitFor(() => expect(mock.approve).toHaveBeenCalledWith(expect.objectContaining({ id: "trs_box", version: 1 })));
    expect(await screen.findByText("Added Boxing: pads and bag to your calendar.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Skip Boxing: pads and bag" }));
    await waitFor(() => expect(mock.skip).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(mock.unskip).toHaveBeenCalledWith(expect.objectContaining({ id: "trs_box" })));
    expect(mock.approveAll).not.toHaveBeenCalled();
  });

  it("checks in with a tap, and asks where when sore", async () => {
    mock.checkin.mockResolvedValue({});
    const { rerender } = render(<TrainingScreen />);
    const checkin = await screen.findByRole("region", { name: "Check in" });
    fireEvent.click(within(checkin).getByRole("button", { name: "Tired" }));
    await waitFor(() => expect(mock.checkin).toHaveBeenCalledWith("2030-09-30", { feeling: "tired" }));
    mock.week.mockResolvedValue(week({ checkin: { id: "c", localDate: "2030-09-30", feeling: "sore", sore: [], sleepHours: null, note: "" }, readiness: { score: 50, word: "Sore", detail: "" } }));
    rerender(<TrainingScreen key="again" />);
    fireEvent.click(await screen.findByRole("button", { name: "Shoulder" }));
    await waitFor(() => expect(mock.checkin).toHaveBeenLastCalledWith("2030-09-30", { sore: ["shoulder"] }));
    expect(screen.getByText("50 · Sore")).toBeTruthy();
  });

  it("logs a session he did with effort and soreness", async () => {
    mock.logUnplanned.mockResolvedValue({ session: session({ status: "done", title: "Boxing", minutes: 60, effort: 7 }), matched: "new" });
    render(<TrainingScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Log" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Discipline" })).getByRole("button", { name: "Boxing" }));
    fireEvent.change(screen.getByLabelText("Minutes"), { target: { value: "60" } });
    fireEvent.click(within(screen.getByRole("group", { name: "Effort" })).getByRole("button", { name: "7" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Anything sore" })).getByRole("button", { name: "Knee" }));
    fireEvent.click(screen.getByRole("button", { name: "Log session" }));
    await waitFor(() => expect(mock.logUnplanned).toHaveBeenCalledWith("boxing", expect.objectContaining({ minutes: 60, effort: 7, sore: ["knee"] })));
    expect(await screen.findByText("Logged Boxing: 60 min · effort 7.")).toBeTruthy();
  });

  it("sends the ask-bar through the fast lane, and hands the rest to a conversation", async () => {
    const onAsk = vi.fn();
    mock.ask.mockResolvedValueOnce({ handled: true, text: "Done, and checked just now: logged Boxing on Mon 30 Sep: 60 min, effort 7." })
      .mockResolvedValueOnce({ handled: false });
    render(<TrainingScreen onAsk={onAsk} />);
    const input = await screen.findByLabelText("Ask about your training");
    fireEvent.change(input, { target: { value: "did boxing 60 minutes effort 7" } });
    fireEvent.submit(input.closest("form")!);
    expect(await screen.findByText("Logged Boxing on Mon 30 Sep: 60 min, effort 7.")).toBeTruthy();
    fireEvent.change(input, { target: { value: "how do I fix my guard" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(onAsk).toHaveBeenCalledWith("how do I fix my guard"));
  });
});
