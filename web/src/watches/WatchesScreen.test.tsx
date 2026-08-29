// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({
  fetchWatches: vi.fn(),
  createWatchApi: vi.fn(),
  setWatchEnabled: vi.fn(),
  deleteWatchApi: vi.fn(),
}));

vi.mock("../api.js", () => ({
  fetchWatches: api.fetchWatches,
  createWatchApi: api.createWatchApi,
  setWatchEnabled: api.setWatchEnabled,
  deleteWatchApi: api.deleteWatchApi,
}));
vi.mock("../components/ava/PanelShell.js", () => ({
  PanelShell: ({ title, children }: { title: string; children: React.ReactNode }) => <main><h1>{title}</h1>{children}</main>,
}));
vi.mock("../components/ava/BorderGlow.js", () => ({
  BorderGlow: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
}));

import { WatchesScreen, watchStatusLabel } from "./WatchesScreen.js";
import type { WatchRow } from "../api.js";

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
  api.setWatchEnabled.mockReset().mockResolvedValue(undefined);
  api.deleteWatchApi.mockReset().mockResolvedValue(undefined);
});

afterEach(cleanup);

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
});

describe("watchStatusLabel", () => {
  it("keeps disabled, unrun, unknown and failure states honest", () => {
    expect(watchStatusLabel(row({ enabled: 0 }))).toBe("Paused");
    expect(watchStatusLabel(row({ last_status: null }))).toBe("Waiting for first run");
    expect(watchStatusLabel(row({ last_status: "unclear" }))).toBe("Result unclear");
    expect(watchStatusLabel(row({ last_status: "provider_wait" }))).toBe("Status: provider_wait");
  });
});
