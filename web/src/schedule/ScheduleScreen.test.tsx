// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { WatchRow } from "../api.js";

const api = vi.hoisted(() => ({
  fetchWatches: vi.fn(),
  createReminderApi: vi.fn(),
  deleteWatchApi: vi.fn(),
}));
vi.mock("../api.js", async () => {
  const actual = await vi.importActual<typeof import("../api.js")>("../api.js");
  return { ...actual, ...api };
});
vi.mock("../reminders/time.js", async () => {
  const actual = await vi.importActual<typeof import("../reminders/time.js")>("../reminders/time.js");
  return { ...actual, browserTimeZone: () => "Europe/London" };
});
vi.mock("../components/ava/PanelShell.js", () => ({
  PanelShell: ({ title, children }: { title: string; children: React.ReactNode }) => <main><h1>{title}</h1>{children}</main>,
  PanelSection: ({ title, children }: { title: string; children: React.ReactNode }) => <section aria-label={title}>{children}</section>,
}));

import { ApiError, UnconfirmedWriteError } from "../api.js";
import { ScheduleScreen } from "./ScheduleScreen.js";

const NOW = Date.UTC(2026, 8, 24, 12, 0); // Thu 24 Sep 2026, 13:00 in London

function status(over: Record<string, unknown> = {}) {
  return {
    version: 1, occurrenceId: "occ", revision: 1, state: "scheduled", dueAt: NOW + 86_400_000,
    timeZone: "Europe/London", expiresAt: NOW + 86_400_000 + 900_000, attempts: 0, attemptedAt: null,
    nextAttemptAt: null, acceptedAt: null,
    subscriptions: { total: 0, accepted: 0, rejectedTransient: 0, rejectedPermanent: 0, unknown: 0 },
    reasonCode: null, phoneReceipt: "unconfirmed", ...over,
  };
}

function watch(over: Partial<WatchRow>): WatchRow {
  const w: WatchRow = {
    id: "w", prompt: "Reminder", interval_minutes: 0, once: 1, enabled: 1, session_id: null, created_at: 1,
    last_run_at: null, last_status: null, last_result: null, kind: "reminder", run_at: NOW + 86_400_000,
    reminder_status: status(), ...over,
  };
  // A receipt is only trusted for its own occurrence: this watch at this time.
  if (w.reminder_status && typeof w.reminder_status === "object") {
    w.reminder_status = {
      ...(w.reminder_status as object),
      occurrenceId: `reminder:${w.id}:${w.run_at}`, dueAt: w.run_at, expiresAt: Number(w.run_at) + 900_000,
    };
  }
  return w;
}

const later = watch({ id: "later", prompt: "Pay rent", run_at: NOW + 3 * 86_400_000, reminder_status: status({ dueAt: NOW + 3 * 86_400_000 }) });
const soon = watch({ id: "soon", prompt: "Submit coursework", run_at: NOW + 3_600_000, reminder_status: status({ dueAt: NOW + 3_600_000 }) });
const sent = watch({
  id: "sent", prompt: "Call the dentist", run_at: NOW - 86_400_000,
  reminder_status: status({ state: "accepted", dueAt: NOW - 86_400_000, acceptedAt: NOW - 86_000_000, subscriptions: { total: 1, accepted: 1, rejectedTransient: 0, rejectedPermanent: 0, unknown: 0 } }),
});
const check = watch({ id: "check", prompt: "Check the status page", kind: "check", reminder_status: undefined });
const daily = watch({ id: "daily", prompt: "Drink water", run_at: null, daily_at: "09:00", reminder_status: undefined });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  api.fetchWatches.mockReset().mockResolvedValue([later, check, sent, soon, daily]);
  api.createReminderApi.mockReset().mockResolvedValue(watch({ id: "new" }));
  api.deleteWatchApi.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const promptBox = () => screen.getByLabelText("What should AVA remind you about?");
const whenBox = () => screen.getByLabelText("When");
const saveButton = () => screen.getByRole("button", { name: /Save reminder|Saving/ });

describe("Schedule", () => {
  it("lists only direct one-off reminders: upcoming soonest first, then earlier", async () => {
    render(<ScheduleScreen onOpenTalk={vi.fn()} />);
    const upcoming = await screen.findByRole("region", { name: "Upcoming" });
    const upcomingText = upcoming.textContent!;
    expect(upcomingText.indexOf("Submit coursework")).toBeLessThan(upcomingText.indexOf("Pay rent"));
    expect(within(upcoming).getAllByText("Scheduled")).toHaveLength(2);
    const earlier = screen.getByRole("region", { name: "Earlier" });
    expect(within(earlier).getByText("Call the dentist")).toBeTruthy();
    expect(within(earlier).getByText("Accepted by notification service")).toBeTruthy();
    expect(earlier.textContent).toContain("can't confirm your phone showed it");
    expect(screen.queryByText("Check the status page")).toBeNull();
    expect(screen.queryByText("Drink water")).toBeNull();
  });

  it("saves an exact instant with the named zone, then shows the stored list", async () => {
    render(<ScheduleScreen onOpenTalk={vi.fn()} />);
    await screen.findByText("Pay rent");
    fireEvent.change(promptBox(), { target: { value: "  Hand in the essay  " } });
    fireEvent.change(whenBox(), { target: { value: "2026-09-30T09:00" } });
    expect(screen.getByText("Wed 30 Sep 2026, 09:00 · Europe/London (UTC+01:00)")).toBeTruthy();
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.createReminderApi).toHaveBeenCalledWith({
      prompt: "Hand in the essay", runAt: Date.UTC(2026, 8, 30, 8, 0), timeZone: "Europe/London",
    }));
    expect(await screen.findByText("Reminder saved.")).toBeTruthy();
    expect((promptBox() as HTMLTextAreaElement).value).toBe("");
    expect(api.fetchWatches).toHaveBeenCalledTimes(2);
  });

  it("holds the form still while saving", async () => {
    let finish!: () => void;
    api.createReminderApi.mockReturnValue(new Promise((resolve) => { finish = () => resolve(watch({ id: "new" })); }));
    render(<ScheduleScreen onOpenTalk={vi.fn()} />);
    await screen.findByText("Pay rent");
    fireEvent.change(promptBox(), { target: { value: "Hand in the essay" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect((promptBox() as HTMLTextAreaElement).readOnly).toBe(true));
    expect((whenBox() as HTMLInputElement).disabled).toBe(true);
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
    finish();
    expect(await screen.findByText("Reminder saved.")).toBeTruthy();
  });

  it("refuses a time skipped by the clocks going forward", async () => {
    render(<ScheduleScreen onOpenTalk={vi.fn()} />);
    await screen.findByText("Pay rent");
    fireEvent.change(promptBox(), { target: { value: "Early start" } });
    fireEvent.change(whenBox(), { target: { value: "2027-03-28T01:30" } });
    expect(screen.getByRole("alert").textContent).toContain("doesn't exist on 28 March 2027 in Europe/London");
    fireEvent.click(saveButton());
    expect(api.createReminderApi).not.toHaveBeenCalled();
  });

  it("asks which one is meant when a time happens twice, then saves that exact instant", async () => {
    render(<ScheduleScreen onOpenTalk={vi.fn()} />);
    await screen.findByText("Pay rent");
    fireEvent.change(promptBox(), { target: { value: "Night bus" } });
    fireEvent.change(whenBox(), { target: { value: "2026-10-25T01:30" } });
    fireEvent.click(saveButton());
    expect(screen.getByRole("alert").textContent).toContain("happens twice on 25 October 2026");
    expect(api.createReminderApi).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("The second one (UTC+00:00)"));
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.createReminderApi).toHaveBeenCalledWith({
      prompt: "Night bus", runAt: Date.UTC(2026, 9, 25, 1, 30), timeZone: "Europe/London",
    }));
  });

  it("refuses past times and times more than a year ahead before calling AVA", async () => {
    render(<ScheduleScreen onOpenTalk={vi.fn()} />);
    await screen.findByText("Pay rent");
    fireEvent.change(promptBox(), { target: { value: "Something" } });
    fireEvent.change(whenBox(), { target: { value: "2026-09-24T09:00" } });
    fireEvent.click(saveButton());
    expect(screen.getByRole("alert").textContent).toBe("Choose a time in the future.");
    fireEvent.change(whenBox(), { target: { value: "2027-10-01T09:00" } });
    fireEvent.click(saveButton());
    expect(screen.getByRole("alert").textContent).toBe("Choose a time within the next year.");
    expect(api.createReminderApi).not.toHaveBeenCalled();
  });

  it("explains a validation refusal in plain words and keeps the form", async () => {
    const refusal = new ApiError(400, "bad_request", "bad_request");
    refusal.reasonCode = "run_at_not_future";
    api.createReminderApi.mockRejectedValue(refusal);
    render(<ScheduleScreen onOpenTalk={vi.fn()} />);
    await screen.findByText("Pay rent");
    fireEvent.change(promptBox(), { target: { value: "Hand in the essay" } });
    fireEvent.click(saveButton());
    expect(await screen.findByText("That time has already passed. Choose a time in the future.")).toBeTruthy();
    expect((promptBox() as HTMLTextAreaElement).value).toBe("Hand in the essay");
  });

  it("never shows a raw server code for an unknown refusal", async () => {
    const refusal = new ApiError(400, "bad_request", "bad_request");
    refusal.reasonCode = "some_new_rule";
    api.createReminderApi.mockRejectedValue(refusal);
    render(<ScheduleScreen onOpenTalk={vi.fn()} />);
    await screen.findByText("Pay rent");
    fireEvent.change(promptBox(), { target: { value: "Hand in the essay" } });
    fireEvent.click(saveButton());
    const message = await screen.findByText(/AVA couldn't accept this reminder/);
    expect(message.textContent).not.toContain("some_new_rule");
  });

  it("after an unconfirmed save, shows the uncertainty and the refreshed list, and never resends", async () => {
    api.createReminderApi.mockRejectedValue(new ApiError(0, "AVA's server is unreachable."));
    render(<ScheduleScreen onOpenTalk={vi.fn()} />);
    await screen.findByText("Pay rent");
    fireEvent.change(promptBox(), { target: { value: "Hand in the essay" } });
    fireEvent.change(whenBox(), { target: { value: "2026-09-30T09:00" } });
    // Even an identical row in the refreshed list is not proof it was this save.
    api.fetchWatches.mockResolvedValue([later, watch({ id: "same", prompt: "Hand in the essay", run_at: Date.UTC(2026, 8, 30, 8, 0) })]);
    fireEvent.click(saveButton());
    expect(await screen.findByText(/couldn't confirm whether this reminder was saved/)).toBeTruthy();
    await screen.findByText("Hand in the essay", { selector: "li span" });
    expect(screen.queryByText("Reminder saved.")).toBeNull();
    expect((promptBox() as HTMLTextAreaElement).value).toBe("Hand in the essay");
    expect(api.fetchWatches).toHaveBeenCalledTimes(2);
    expect(api.createReminderApi).toHaveBeenCalledTimes(1);
  });

  it("treats a 5xx as uncertain too, but a 4xx as a definite refusal", async () => {
    api.createReminderApi.mockRejectedValueOnce(new ApiError(502, "Bad gateway"));
    render(<ScheduleScreen onOpenTalk={vi.fn()} />);
    await screen.findByText("Pay rent");
    fireEvent.change(promptBox(), { target: { value: "Hand in the essay" } });
    fireEvent.click(saveButton());
    expect(await screen.findByText(/couldn't confirm whether this reminder was saved/)).toBeTruthy();
    api.createReminderApi.mockRejectedValueOnce(new ApiError(400, "bad_request", "bad_request"));
    fireEvent.click(saveButton());
    expect(await screen.findByText(/AVA couldn't accept this reminder/)).toBeTruthy();
    expect(api.createReminderApi).toHaveBeenCalledTimes(2);
  });

  it("deletes only after a second, explicit confirmation", async () => {
    render(<ScheduleScreen onOpenTalk={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete reminder: Pay rent" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(api.deleteWatchApi).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete reminder: Pay rent" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete it" }));
    await waitFor(() => expect(api.deleteWatchApi).toHaveBeenCalledWith("later"));
  });

  it("has honest empty, loading and error states", async () => {
    let finish!: (value: WatchRow[]) => void;
    api.fetchWatches.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const view = render(<ScheduleScreen onOpenTalk={vi.fn()} />);
    expect(screen.getByText("Loading reminders…")).toBeTruthy();
    finish([check]);
    expect(await screen.findByText(/No reminders yet/)).toBeTruthy();
    view.unmount();

    api.fetchWatches.mockRejectedValueOnce(new Error("AVA's server is unreachable."));
    render(<ScheduleScreen onOpenTalk={vi.fn()} />);
    expect(await screen.findByText("AVA's server is unreachable.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Pay rent")).toBeTruthy();
  });

  it("explains what AVA can and cannot confirm, and links to Talk", async () => {
    const onOpenTalk = vi.fn();
    render(<ScheduleScreen onOpenTalk={onOpenTalk} />);
    const how = screen.getByRole("region", { name: "How reminders reach you" });
    expect(how.textContent).toContain("It can't see whether your phone showed it.");
    fireEvent.click(within(how).getByRole("button", { name: "Go to Talk" }));
    expect(onOpenTalk).toHaveBeenCalledOnce();
    await screen.findByText("Pay rent");
  });
});

describe("Schedule readback under failure (#385, #386, #388)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("never lets an older, slower refresh overwrite a newer one", async () => {
    let finishFirst!: (rows: WatchRow[]) => void;
    const created = watch({ id: "new", prompt: "Hand in the essay", run_at: Date.UTC(2026, 8, 30, 8, 0) });
    api.fetchWatches.mockReset()
      .mockReturnValueOnce(new Promise((resolve) => { finishFirst = resolve; }))
      .mockResolvedValue([later, created]);
    api.createReminderApi.mockResolvedValue(created);
    render(<ScheduleScreen onOpenTalk={vi.fn()} />);
    fireEvent.change(promptBox(), { target: { value: "Hand in the essay" } });
    fireEvent.change(whenBox(), { target: { value: "2026-09-30T09:00" } });
    fireEvent.click(saveButton());
    expect(await screen.findByText("Hand in the essay", { selector: "li span" })).toBeTruthy();
    // The first poll, asked before the save, answers last with the old list.
    finishFirst([later]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByText("Hand in the essay", { selector: "li span" })).toBeTruthy();
  });

  it("keeps the last rows but says so when a refresh fails", async () => {
    render(<ScheduleScreen onOpenTalk={vi.fn()} />);
    await screen.findByText("Pay rent");
    api.fetchWatches.mockRejectedValue(new Error("AVA's server is unreachable."));
    act(() => { window.dispatchEvent(new Event("focus")); });
    expect(await screen.findByText(/Couldn't refresh\. Showing reminders as of/)).toBeTruthy();
    expect(screen.getByText("Pay rent")).toBeTruthy();
    api.fetchWatches.mockResolvedValue([later]);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByText(/Couldn't refresh/)).toBeNull());
  });

  it("removes a deleted row even when the refresh after it fails, and never sticks on Deleting", async () => {
    render(<ScheduleScreen onOpenTalk={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete reminder: Pay rent" }));
    api.fetchWatches.mockRejectedValue(new Error("AVA's server is unreachable."));
    fireEvent.click(screen.getByRole("button", { name: "Delete it" }));
    await waitFor(() => expect(screen.queryByText("Pay rent")).toBeNull());
    expect(screen.queryByRole("button", { name: /Deleting/ })).toBeNull();
    expect(await screen.findByText(/Couldn't refresh/)).toBeTruthy();
    expect(screen.getByText("Submit coursework")).toBeTruthy();
  });

  it("keeps the draft and stays uncertain when AVA's answer doesn't prove the save", async () => {
    api.createReminderApi.mockRejectedValue(new UnconfirmedWriteError("AVA's answer didn't confirm the reminder was saved."));
    render(<ScheduleScreen onOpenTalk={vi.fn()} />);
    await screen.findByText("Pay rent");
    fireEvent.change(promptBox(), { target: { value: "Hand in the essay" } });
    fireEvent.click(saveButton());
    expect(await screen.findByText(/couldn't confirm whether this reminder was saved\. The list has been refreshed/)).toBeTruthy();
    expect(screen.queryByText("Reminder saved.")).toBeNull();
    expect((promptBox() as HTMLTextAreaElement).value).toBe("Hand in the essay");
    expect(api.createReminderApi).toHaveBeenCalledTimes(1);
  });

  it("says so when the list couldn't be refreshed after an unconfirmed save either", async () => {
    api.createReminderApi.mockRejectedValue(new ApiError(0, "AVA's server is unreachable."));
    render(<ScheduleScreen onOpenTalk={vi.fn()} />);
    await screen.findByText("Pay rent");
    api.fetchWatches.mockRejectedValue(new Error("AVA's server is unreachable."));
    fireEvent.change(promptBox(), { target: { value: "Hand in the essay" } });
    fireEvent.click(saveButton());
    expect(await screen.findByText(/and the list couldn't be refreshed either/)).toBeTruthy();
    expect(screen.queryByText(/The list has been refreshed/)).toBeNull();
  });
});
