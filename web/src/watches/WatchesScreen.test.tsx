// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({
  fetchWatches: vi.fn(),
  createWatchApi: vi.fn(),
  createReminderApi: vi.fn(),
  setWatchEnabled: vi.fn(),
  deleteWatchApi: vi.fn(),
  fetchWatchCommunicationEvidence: vi.fn(),
  fetchMissionMeta: vi.fn(),
  subscribeMissionEvents: vi.fn((_options?: unknown) => () => {}),
}));

vi.mock("../api.js", async () => ({
  ApiError: (await vi.importActual<typeof import("../api.js")>("../api.js")).ApiError,
  fetchWatches: api.fetchWatches,
  createWatchApi: api.createWatchApi,
  createReminderApi: api.createReminderApi,
  setWatchEnabled: api.setWatchEnabled,
  deleteWatchApi: api.deleteWatchApi,
  fetchWatchCommunicationEvidence: api.fetchWatchCommunicationEvidence,
  fetchMissionMeta: api.fetchMissionMeta,
  subscribeMissionEvents: api.subscribeMissionEvents,
}));
vi.mock("../reminders/time.js", async () => ({
  ...(await vi.importActual<typeof import("../reminders/time.js")>("../reminders/time.js")),
  browserTimeZone: () => "Europe/London",
}));
vi.mock("../components/ava/PanelShell.js", () => ({
  PanelShell: ({ title, children }: { title: string; children: React.ReactNode }) => <main><h1>{title}</h1>{children}</main>,
}));
vi.mock("../components/ava/BorderGlow.js", () => ({
  BorderGlow: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
}));

import { WatchesScreen, watchStatusLabel } from "./WatchesScreen.js";
import type { MissionEvent, WatchRow } from "../api.js";

const row = (patch: Partial<WatchRow> = {}): WatchRow => ({
  id: "watch-1",
  prompt: "Tell me when the status page changes",
  interval_minutes: 30,
  once: 1,
  enabled: 1,
  session_id: "session-1",
  created_at: Date.now() - 60_000,
  last_run_at: Date.now() - 30_000,
  last_status: "ok",
  last_result: "No change detected",
  run_at: null,
  daily_at: null,
  kind: "check",
  ...patch,
});

beforeEach(() => {
  localStorage.setItem("ava-motion", "reduced");
  api.fetchWatches.mockReset().mockResolvedValue([]);
  api.createWatchApi.mockReset();
  api.createReminderApi.mockReset();
  api.setWatchEnabled.mockReset().mockResolvedValue(undefined);
  api.deleteWatchApi.mockReset().mockResolvedValue(undefined);
  api.fetchWatchCommunicationEvidence.mockReset().mockResolvedValue({ availability: "unavailable" });
  api.fetchMissionMeta.mockReset().mockResolvedValue({ eventBounds: { min: 1, max: 100 } });
  api.subscribeMissionEvents.mockReset().mockImplementation((_options?: unknown) => () => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("WatchesScreen", () => {
  it("renders truthful counts, lifecycle evidence, and no unsupported run-now control", async () => {
    api.fetchWatches.mockResolvedValue([
      row(),
      row({ id: "watch-2", prompt: "Paused reminder", kind: "reminder", enabled: 0, last_status: null, last_result: null }),
      row({ id: "watch-3", prompt: "Broken check", last_status: "error", last_result: "network unavailable" }),
    ]);
    render(<WatchesScreen onOpenChat={() => undefined} />);

    expect(await screen.findByText("Tell me when the status page changes")).toBeTruthy();
    expect(screen.getByText("No change detected")).toBeTruthy();
    expect(screen.getByText("Check failed")).toBeTruthy();
    expect(screen.getByText("network unavailable")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /run now/i })).toBeNull();
    expect(screen.getAllByText("3").length).toBeGreaterThan(0);
  });

  it("creates a bounded interval check through the existing API", async () => {
    const created = row({ id: "new-watch", prompt: "Watch the deployment status", last_run_at: null, last_status: null, last_result: null });
    api.createWatchApi.mockResolvedValue(created);
    render(<WatchesScreen onOpenChat={() => undefined} />);
    await screen.findByText("No watches yet.");

    fireEvent.change(screen.getByRole("textbox", { name: /What should AVA check/ }), { target: { value: "  Watch the deployment status  " } });
    fireEvent.click(screen.getByRole("button", { name: "Create watch" }));

    await waitFor(() => expect(api.createWatchApi).toHaveBeenCalledWith({
      prompt: "Watch the deployment status",
      kind: "check",
      once: true,
      intervalMinutes: 30,
    }));
    expect(await screen.findByText("Watch the deployment status")).toBeTruthy();
  });

  it("creates a repeating daily reminder without converting it to an agent check", async () => {
    api.createWatchApi.mockResolvedValue(row({ id: "daily", prompt: "Stand up", kind: "reminder", daily_at: "08:15", once: 0 }));
    render(<WatchesScreen onOpenChat={() => undefined} />);
    await screen.findByText("No watches yet.");

    fireEvent.click(screen.getByRole("button", { name: "Reminder" }));
    fireEvent.click(screen.getByRole("button", { name: "Daily" }));
    fireEvent.change(screen.getByRole("textbox", { name: /What should AVA remind you/ }), { target: { value: "Stand up" } });
    fireEvent.change(screen.getByLabelText("Every day at"), { target: { value: "08:15" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Create watch" }));

    await waitFor(() => expect(api.createWatchApi).toHaveBeenCalledWith({
      prompt: "Stand up",
      kind: "reminder",
      once: false,
      dailyAt: "08:15",
    }));
  });

  it("rejects a past one-time schedule before contacting the server", async () => {
    render(<WatchesScreen onOpenChat={() => undefined} />);
    await screen.findByText("No watches yet.");
    fireEvent.click(screen.getByRole("button", { name: "One time" }));
    fireEvent.change(screen.getByRole("textbox", { name: /What should AVA check/ }), { target: { value: "Check later" } });
    fireEvent.change(screen.getByLabelText("Run at"), { target: { value: "2020-01-01T10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Create watch" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Choose a future date and time.");
    expect(api.createWatchApi).not.toHaveBeenCalled();
  });

  it("filters, pauses, opens history, and confirms deletion", async () => {
    const openChat = vi.fn();
    api.fetchWatches.mockResolvedValue([
      row(),
      row({ id: "paused", prompt: "Paused item", enabled: 0, session_id: null, last_status: null }),
      row({ id: "error", prompt: "Needs help", last_status: "unclear", session_id: null }),
    ]);
    render(<WatchesScreen onOpenChat={openChat} />);
    await screen.findByText("Tell me when the status page changes");

    fireEvent.click(screen.getByRole("button", { name: "Paused" }));
    expect(screen.getByText("Paused item")).toBeTruthy();
    expect(screen.queryByText("Needs help")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "All" }));

    fireEvent.click(screen.getByRole("button", { name: "Pause Tell me when the status page changes" }));
    await waitFor(() => expect(api.setWatchEnabled).toHaveBeenCalledWith("watch-1", false));
    fireEvent.click(screen.getByRole("button", { name: "Open history" }));
    expect(openChat).toHaveBeenCalledWith("session-1");

    fireEvent.click(screen.getByRole("button", { name: "Delete Paused item" }));
    expect(api.deleteWatchApi).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete Paused item" }));
    await waitFor(() => expect(api.deleteWatchApi).toHaveBeenCalledWith("paused"));
    expect(screen.queryByText("Paused item")).toBeNull();
  });

  it("surfaces endpoint failures instead of implying a state change", async () => {
    api.fetchWatches.mockResolvedValue([row()]);
    api.setWatchEnabled.mockRejectedValue(new Error("server unavailable"));
    render(<WatchesScreen onOpenChat={() => undefined} />);
    await screen.findByText("Tell me when the status page changes");
    fireEvent.click(screen.getByRole("button", { name: "Pause Tell me when the status page changes" }));
    expect((await screen.findByRole("alert")).textContent).toContain("server unavailable");
  });

  it("focuses the exact Codex watcher selected by Mission Control and preserves a back action", async () => {
    const back = vi.fn();
    api.fetchWatches.mockResolvedValue([
      row({ id: "ordinary", prompt: "Ordinary check" }),
      row({ id: "codex-exact", prompt: "Exact Codex handoff", kind: "codex", last_status: "completed" }),
    ]);
    render(
      <WatchesScreen
        onOpenChat={() => undefined}
        focusWatchId="codex-exact"
        navigationRequested
        onBackToMissionControl={back}
      />,
    );

    const card = await screen.findByLabelText("Watch: Exact Codex handoff");
    await waitFor(() => expect(document.activeElement).toBe(card));
    expect(card.getAttribute("data-mission-control-target")).toBe("true");
    expect(screen.getByText("Opened the exact Codex watcher recorded by Mission Control.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to Mission Control" }));
    expect(back).toHaveBeenCalledTimes(1);
    expect(api.setWatchEnabled).not.toHaveBeenCalled();
    expect(api.deleteWatchApi).not.toHaveBeenCalled();
  });

  it("uses one non-disclosing unavailable state for missing and wrong-kind watcher targets", async () => {
    api.fetchWatches.mockResolvedValue([row({ id: "ordinary", kind: "check" })]);
    const rendered = render(
      <WatchesScreen onOpenChat={() => undefined} focusWatchId="missing" navigationRequested />,
    );
    expect(await screen.findByText(/Watcher record unavailable/)).toBeTruthy();
    expect(screen.queryByText("missing")).toBeNull();

    rendered.unmount();
    render(<WatchesScreen onOpenChat={() => undefined} focusWatchId="ordinary" navigationRequested />);
    expect(await screen.findByText(/Watcher record unavailable/)).toBeTruthy();
    expect(screen.queryByText("Opened the exact Codex watcher recorded by Mission Control.")).toBeNull();
  });

  it("links an exact Codex watch to its retained Mission Control run without adding controls", async () => {
    api.fetchWatches.mockResolvedValue([row({
      id: "codex-evidence",
      prompt: "Inspect the finished Codex task",
      kind: "codex",
      communication_evidence: {
        availability: "available",
        runId: "communication:codex_watcher:codex-evidence",
      },
    })]);
    render(<WatchesScreen onOpenChat={() => undefined} />);

    const link = await screen.findByRole("link", { name: "Open exact communication in Mission Control" });
    expect(link.getAttribute("href")).toBe("/?mission-control=1&run=communication%3Acodex_watcher%3Acodex-evidence&from=watches");
    link.focus();
    expect(document.activeElement).toBe(link);
    expect(screen.getByText("Exact communication evidence retained")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /send|retry|approve|run now/i })).toBeNull();
  });

  it("does not disclose malformed evidence IDs or attach evidence to non-Codex watches", async () => {
    api.fetchWatches.mockResolvedValue([
      row({
        id: "codex-malformed",
        prompt: "Malformed evidence",
        kind: "codex",
        communication_evidence: { availability: "available", runId: "../../secret-run" },
      }),
      row({
        id: "ordinary-with-field",
        prompt: "Ordinary check",
        kind: "check",
        communication_evidence: { availability: "available", runId: "communication:codex_watcher:wrong" },
      }),
    ]);
    render(<WatchesScreen onOpenChat={() => undefined} />);

    expect(await screen.findByText("Malformed evidence")).toBeTruthy();
    expect(screen.getByText("Mission Control evidence unavailable or not retained.")).toBeTruthy();
    expect(screen.queryByText("../../secret-run")).toBeNull();
    expect(screen.queryByRole("link", { name: "Open exact communication in Mission Control" })).toBeNull();
    const ordinaryCard = screen.getByLabelText("Watch: Ordinary check");
    expect(ordinaryCard.textContent).not.toContain("Mission Control evidence");
  });

  it("revalidates an already-rendered receipt on its exact Mission Control SSE identity", async () => {
    const available = row({
      id: "codex-live",
      prompt: "Live evidence",
      kind: "codex",
      communication_evidence: {
        availability: "available",
        runId: "communication:codex_watcher:codex-live",
      },
    });
    api.fetchWatches
      .mockResolvedValueOnce([available])
      .mockResolvedValueOnce([row({
        ...available,
        communication_evidence: { availability: "unavailable" },
      })]);
    render(<WatchesScreen onOpenChat={() => undefined} />);

    const exactLink = await screen.findByRole("link", { name: "Open exact communication in Mission Control" });
    exactLink.focus();
    await waitFor(() => expect(api.subscribeMissionEvents).toHaveBeenCalledTimes(1));
    const stream = api.subscribeMissionEvents.mock.calls[0]?.[0] as {
      onEvent: (event: MissionEvent) => void;
    };
    const matchingEvent = {
      runId: "communication:codex_watcher:codex-live",
      payload: { communicationSource: "codex_watcher", sourceId: "codex-live" },
    } as MissionEvent;
    act(() => {
      stream.onEvent(matchingEvent);
      stream.onEvent(matchingEvent);
    });

    expect(await screen.findByText("Mission Control evidence unavailable or not retained.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Open exact communication in Mission Control" })).toBeNull();
    expect(document.body.textContent).not.toContain("communication:codex_watcher:codex-live");
    expect(api.fetchWatches).toHaveBeenCalledTimes(2);
  });

  it("promotes an unavailable receipt only after an exact normalized source event revalidates it", async () => {
    const unavailable = row({
      id: "codex-new-evidence",
      prompt: "New evidence",
      kind: "codex",
      communication_evidence: { availability: "unavailable" },
    });
    api.fetchWatches
      .mockResolvedValueOnce([unavailable])
      .mockResolvedValueOnce([row({
        ...unavailable,
        communication_evidence: {
          availability: "available",
          runId: "communication:codex_watcher:codex-new-evidence",
        },
      })]);
    render(<WatchesScreen onOpenChat={() => undefined} />);

    expect(await screen.findByText("Mission Control evidence unavailable or not retained.")).toBeTruthy();
    await waitFor(() => expect(api.subscribeMissionEvents).toHaveBeenCalledTimes(1));
    const stream = api.subscribeMissionEvents.mock.calls[0]?.[0] as {
      onEvent: (event: MissionEvent) => void;
    };
    act(() => stream.onEvent({
      runId: "opaque-authoritative-run-id",
      payload: { communicationSource: "codex_watcher", sourceId: "codex-new-evidence" },
    } as MissionEvent));

    expect(await screen.findByRole("link", { name: "Open exact communication in Mission Control" })).toBeTruthy();
    expect(api.fetchWatches).toHaveBeenCalledTimes(2);
  });

  it("ignores unrelated SSE identities and fails a visible receipt closed on focus revalidation error", async () => {
    const available = row({
      id: "codex-focus",
      prompt: "Focus evidence",
      kind: "codex",
      communication_evidence: {
        availability: "available",
        runId: "communication:codex_watcher:codex-focus",
      },
    });
    api.fetchWatches.mockResolvedValueOnce([available]).mockRejectedValueOnce(new Error("private resolver detail"));
    render(<WatchesScreen onOpenChat={() => undefined} />);

    const link = await screen.findByRole("link", { name: "Open exact communication in Mission Control" });
    link.focus();
    await waitFor(() => expect(api.subscribeMissionEvents).toHaveBeenCalledTimes(1));
    const stream = api.subscribeMissionEvents.mock.calls[0]?.[0] as {
      onEvent: (event: MissionEvent) => void;
    };
    act(() => stream.onEvent({
      runId: "communication:provider_discussion:other",
      payload: { communicationSource: "provider_discussion", sourceId: "other" },
    } as MissionEvent));
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 160)); });
    expect(api.fetchWatches).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(link);

    act(() => window.dispatchEvent(new Event("focus")));
    expect(await screen.findByText("Mission Control evidence unavailable or not retained.")).toBeTruthy();
    expect(document.body.textContent).not.toContain("private resolver detail");
    expect(screen.queryByRole("link", { name: "Open exact communication in Mission Control" })).toBeNull();
  });

  it("removes an expired exact receipt while the tab stays continuously foregrounded", async () => {
    vi.useFakeTimers();
    const available = row({
      id: "codex-expired-live",
      prompt: "Continuously visible receipt",
      kind: "codex",
      communication_evidence: {
        availability: "available",
        runId: "communication:codex_watcher:codex-expired-live",
      },
    });
    api.fetchWatches.mockResolvedValue([available]);
    api.fetchWatchCommunicationEvidence.mockResolvedValue({ availability: "unavailable" });
    render(<WatchesScreen onOpenChat={() => undefined} />);

    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByRole("link", { name: "Open exact communication in Mission Control" })).toBeTruthy();
    expect(api.subscribeMissionEvents).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.fetchWatchCommunicationEvidence).toHaveBeenCalledTimes(1);
    expect(api.fetchWatchCommunicationEvidence).toHaveBeenCalledWith("codex-expired-live");
    expect(screen.getByText("Mission Control evidence unavailable or not retained.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Open exact communication in Mission Control" })).toBeNull();
    expect(document.body.textContent).not.toContain("communication:codex_watcher:codex-expired-live");
    expect(api.fetchWatches).toHaveBeenCalledTimes(1);
  });

  it("fails a receipt closed on transport error and retries its exact proof with bounded backoff", async () => {
    vi.useFakeTimers();
    const available = row({
      id: "codex-backoff",
      prompt: "Backoff receipt",
      kind: "codex",
      communication_evidence: {
        availability: "available",
        runId: "communication:codex_watcher:codex-backoff",
      },
    });
    api.fetchWatches.mockResolvedValue([available]);
    api.fetchWatchCommunicationEvidence
      .mockRejectedValueOnce(new Error("private transport detail"))
      .mockResolvedValueOnce(available.communication_evidence);
    render(<WatchesScreen onOpenChat={() => undefined} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("Mission Control evidence unavailable or not retained.")).toBeTruthy();
    expect(document.body.textContent).not.toContain("private transport detail");
    expect(api.fetchWatchCommunicationEvidence).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(9_999);
      await Promise.resolve();
    });
    expect(api.fetchWatchCommunicationEvidence).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.fetchWatchCommunicationEvidence).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("link", { name: "Open exact communication in Mission Control" })).toBeTruthy();
  });

  it("bounds foreground checks to twelve visible proven receipts and ignores ordinary watches", async () => {
    vi.useFakeTimers();
    const codexRows = Array.from({ length: 13 }, (_, index) => row({
      id: `codex-bounded-${index}`,
      prompt: `Bounded receipt ${index}`,
      kind: "codex",
      communication_evidence: {
        availability: "available",
        runId: `communication:codex_watcher:codex-bounded-${index}`,
      },
    }));
    api.fetchWatches.mockResolvedValue([
      ...codexRows,
      row({ id: "ordinary-bounded", prompt: "Ordinary", kind: "check" }),
    ]);
    api.fetchWatchCommunicationEvidence.mockImplementation(async (id: string) => ({
      availability: "available",
      runId: `communication:codex_watcher:${id}`,
    }));
    render(<WatchesScreen onOpenChat={() => undefined} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.fetchWatchCommunicationEvidence).toHaveBeenCalledTimes(12);
    expect(api.fetchWatchCommunicationEvidence).not.toHaveBeenCalledWith("codex-bounded-12");
    expect(api.fetchWatchCommunicationEvidence).not.toHaveBeenCalledWith("ordinary-bounded");
  });
});

describe("watchStatusLabel", () => {
  it("keeps disabled, unrun, unknown and failure states honest", () => {
    expect(watchStatusLabel(row({ enabled: 0 }))).toBe("Paused");
    expect(watchStatusLabel(row({ last_status: null }))).toBe("Waiting for first run");
    expect(watchStatusLabel(row({ last_status: "unclear" }))).toBe("Result unclear");
    expect(watchStatusLabel(row({ last_status: "provider_wait" }))).toBe("Status: provider_wait");
  });
});

describe("Watches: dependable one-time reminders (i4 v2)", () => {
  const DUE = Date.UTC(2026, 9, 30, 9, 0);
  const receipt = (over: Record<string, unknown> = {}) => ({
    version: 1, occurrenceId: `reminder:r:${DUE}`, revision: 1, state: "accepted", dueAt: DUE, timeZone: "Europe/London",
    expiresAt: DUE + 900_000, attempts: 1, attemptedAt: DUE, nextAttemptAt: null, acceptedAt: DUE + 500,
    subscriptions: { total: 1, accepted: 1, rejectedTransient: 0, rejectedPermanent: 0, unknown: 0 },
    reasonCode: null, phoneReceipt: "unconfirmed", ...over,
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2026, 8, 24, 12, 0));
  });
  afterEach(() => { vi.useRealTimers(); });

  it("creates a one-time reminder as an exact instant in the named zone", async () => {
    api.createReminderApi.mockResolvedValue(row({ id: "r", prompt: "Stretch", kind: "reminder", run_at: DUE }));
    render(<WatchesScreen onOpenChat={() => undefined} />);
    await screen.findByText("No watches yet.");
    fireEvent.click(screen.getByRole("button", { name: "Reminder" }));
    fireEvent.click(screen.getByRole("button", { name: "One time" }));
    fireEvent.change(screen.getByRole("textbox", { name: /What should AVA remind you/ }), { target: { value: "Stretch" } });
    fireEvent.change(screen.getByLabelText("Run at"), { target: { value: "2026-10-30T09:00" } });
    expect(screen.getByText("Fri 30 Oct 2026, 09:00 · Europe/London (UTC+00:00)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create watch" }));
    await waitFor(() => expect(api.createReminderApi).toHaveBeenCalledWith({
      prompt: "Stretch", runAt: DUE, timeZone: "Europe/London",
    }));
    expect(api.createWatchApi).not.toHaveBeenCalled();
  });

  it("asks which occurrence is meant instead of guessing across the clock change", async () => {
    api.createReminderApi.mockResolvedValue(row({ id: "r", kind: "reminder", run_at: DUE }));
    render(<WatchesScreen onOpenChat={() => undefined} />);
    await screen.findByText("No watches yet.");
    fireEvent.click(screen.getByRole("button", { name: "Reminder" }));
    fireEvent.click(screen.getByRole("button", { name: "One time" }));
    fireEvent.change(screen.getByRole("textbox", { name: /What should AVA remind you/ }), { target: { value: "Night bus" } });
    fireEvent.change(screen.getByLabelText("Run at"), { target: { value: "2026-10-25T01:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Create watch" }));
    expect(api.createReminderApi).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("The first one (UTC+01:00)"));
    fireEvent.click(screen.getByRole("button", { name: "Create watch" }));
    await waitFor(() => expect(api.createReminderApi).toHaveBeenCalledWith({
      prompt: "Night bus", runAt: Date.UTC(2026, 9, 25, 0, 30), timeZone: "Europe/London",
    }));
  });

  it("keeps one-time checks on their existing path", async () => {
    api.createWatchApi.mockResolvedValue(row({ id: "c" }));
    render(<WatchesScreen onOpenChat={() => undefined} />);
    await screen.findByText("No watches yet.");
    fireEvent.click(screen.getByRole("button", { name: "One time" }));
    fireEvent.change(screen.getByRole("textbox", { name: /What should AVA check/ }), { target: { value: "Check later" } });
    fireEvent.change(screen.getByLabelText("Run at"), { target: { value: "2026-10-30T09:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Create watch" }));
    await waitFor(() => expect(api.createWatchApi).toHaveBeenCalled());
    expect(api.createReminderApi).not.toHaveBeenCalled();
  });

  it("shows a reminder's transport receipt, not its old 'Delivered' label", async () => {
    api.fetchWatches.mockResolvedValue([
      row({ id: "r", prompt: "Stretch", kind: "reminder", run_at: DUE, last_status: "delivered", last_result: "delivered", reminder_status: receipt() }),
    ]);
    render(<WatchesScreen onOpenChat={() => undefined} />);
    const card = await screen.findByRole("article", { name: "Watch: Stretch" });
    expect(card.textContent).toContain("Accepted by notification service");
    expect(card.textContent).toContain("AVA can't confirm your phone showed it.");
    expect(card.textContent).not.toMatch(/\bDelivered\b/);
    expect(card.textContent).not.toContain("LAST RESULT");
  });

  it("says a paused in-flight send may still complete", async () => {
    api.fetchWatches.mockResolvedValue([
      row({ id: "r", prompt: "Stretch", kind: "reminder", run_at: DUE, enabled: 0, reminder_status: receipt({ state: "trying", acceptedAt: null }) }),
    ]);
    render(<WatchesScreen onOpenChat={() => undefined} />);
    const card = await screen.findByRole("article", { name: "Watch: Stretch" });
    expect(card.textContent).toContain("Pause requested");
    expect(card.textContent).toContain("outcome is still pending");
  });
});
