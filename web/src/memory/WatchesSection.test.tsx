// @vitest-environment jsdom
// "Standing watches" smoke: watches render (prompt + schedule + last-check line),
// the enabled toggle POSTs, delete needs two taps, and unknown/missing schema
// fields (run_at / daily_at / kind, odd statuses) degrade instead of crashing.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const fetchWatches = vi.fn();
const setWatchEnabled = vi.fn();
const deleteWatchApi = vi.fn();
vi.mock("../api.js", () => ({
  fetchWatches: (...a: unknown[]) => fetchWatches(...a),
  setWatchEnabled: (...a: unknown[]) => setWatchEnabled(...a),
  deleteWatchApi: (...a: unknown[]) => deleteWatchApi(...a),
}));

import { WatchesSection, scheduleLabel, timeAgo } from "./WatchesSection.js";
import type { WatchRow } from "../api.js";

const watch = (over: Partial<WatchRow> = {}): WatchRow => ({
  id: "w1",
  prompt: "watch RTX 5090 price below $1800",
  interval_minutes: 30,
  once: 0,
  enabled: 1,
  session_id: null,
  created_at: 1,
  last_run_at: Date.now() - 5 * 60_000,
  last_status: "ok",
  last_result: "still $2100 — no trigger",
  run_at: null,
  daily_at: null,
  kind: "check",
  ...over,
});

beforeEach(() => {
  localStorage.setItem("ava-motion", "reduced");
  fetchWatches.mockReset();
  setWatchEnabled.mockReset().mockResolvedValue(undefined);
  deleteWatchApi.mockReset().mockResolvedValue(undefined);
});

afterEach(() => cleanup());

describe("WatchesSection", () => {
  it("renders watches with schedule labels and last-check status glyphs", async () => {
    fetchWatches.mockResolvedValue([
      watch(),
      watch({
        id: "w2",
        prompt: "send the morning briefing",
        daily_at: "07:30",
        kind: "reminder",
        last_run_at: Date.now() - 2 * 3_600_000,
        last_status: "triggered",
        last_result: "briefing sent",
      }),
      watch({
        id: "w3",
        prompt: "ping me at six",
        run_at: Date.now() + 60 * 60_000,
        last_run_at: null,
        last_status: null,
        last_result: null,
      }),
    ]);
    render(<WatchesSection />);

    expect(await screen.findByText("watch RTX 5090 price below $1800")).toBeTruthy();
    // Schedule captions: interval / daily / one-shot.
    expect(screen.getByText("every 30 min")).toBeTruthy();
    expect(screen.getByText("daily at 07:30")).toBeTruthy();
    expect(screen.getByText(/^once at /)).toBeTruthy();
    expect(screen.getByText("reminder")).toBeTruthy();
    // Last-check lines: ✓ muted, ● accent, and "no checks yet" for the fresh one.
    expect(screen.getByText("✓")).toBeTruthy();
    expect(screen.getByText("●")).toBeTruthy();
    expect(screen.getByText("still $2100 — no trigger")).toBeTruthy();
    expect(screen.getByText("no checks yet")).toBeTruthy();
    expect(screen.getByText("5m ago")).toBeTruthy();
  });

  it("toggling calls the enabled endpoint with the flipped value", async () => {
    fetchWatches.mockResolvedValue([watch()]);
    render(<WatchesSection />);
    await screen.findByText("watch RTX 5090 price below $1800");

    fireEvent.click(screen.getByRole("switch", { name: "enabled" }));
    await waitFor(() => expect(setWatchEnabled).toHaveBeenCalledWith("w1", false));
  });

  it("delete is two-tap: first tap arms, second tap deletes", async () => {
    fetchWatches.mockResolvedValue([watch()]);
    render(<WatchesSection />);
    await screen.findByText("watch RTX 5090 price below $1800");

    fireEvent.click(screen.getByRole("button", { name: "delete" }));
    expect(deleteWatchApi).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "confirm delete" }));
    await waitFor(() => expect(deleteWatchApi).toHaveBeenCalledWith("w1"));
    await waitFor(() =>
      expect(screen.queryByText("watch RTX 5090 price below $1800")).toBeNull(),
    );
  });

  it("shows the empty state when no watches exist", async () => {
    fetchWatches.mockResolvedValue([]);
    render(<WatchesSection />);
    expect(await screen.findByText(/No standing watches/)).toBeTruthy();
  });

  it("makes pinned Codex delivery and cycle state visible", async () => {
    fetchWatches.mockResolvedValue([watch({
      id: "codex-1",
      prompt: "build the Notes system",
      kind: "codex",
      continue_cycle: 1,
      last_status: "running",
      last_result: "Codex accepted the watcher instruction and is still working",
      successor_status: "blocked",
      successor_result: "AVA could not select the next Codex task: provider quota exhausted",
      successor_attempted_at: Date.now() - 60_000,
    })]);
    render(<WatchesSection />);

    expect(await screen.findByText("Codex task")).toBeTruthy();
    expect(screen.getByText("continuous cycle")).toBeTruthy();
    expect(screen.getByLabelText("last check: running")).toBeTruthy();
    expect(screen.getByLabelText("successor planning: blocked")).toBeTruthy();
    expect(screen.getByText(/provider quota exhausted/)).toBeTruthy();
  });

  it("renders defensively: missing new columns + unknown status do not crash", async () => {
    fetchWatches.mockResolvedValue([
      // Base-schema row: no run_at / daily_at / kind at all, bogus status.
      {
        id: "wx",
        prompt: "legacy watch",
        interval_minutes: 15,
        once: 1,
        enabled: 0,
        session_id: null,
        created_at: 1,
        last_run_at: Date.now() - 60_000,
        last_status: "bogus-status",
        last_result: null,
      } as WatchRow,
    ]);
    render(<WatchesSection />);

    expect(await screen.findByText("legacy watch")).toBeTruthy();
    expect(screen.getByText("every 15 min · once")).toBeTruthy();
    expect(screen.getByText("?")).toBeTruthy(); // unknown status → unclear glyph
    expect(screen.getByText("(no result)")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "enabled" }).getAttribute("aria-checked")).toBe("false");
  });

  it("scheduleLabel + timeAgo cover every schedule shape", () => {
    expect(scheduleLabel({ interval_minutes: 45 })).toBe("every 45 min");
    expect(scheduleLabel({ interval_minutes: 60, once: 1 })).toBe("every 60 min · once");
    expect(scheduleLabel({ daily_at: "07:30" })).toBe("daily at 07:30");
    expect(scheduleLabel({ run_at: Date.now() })).toMatch(/^once at /);
    expect(scheduleLabel({})).toBe("schedule unknown");
    expect(scheduleLabel({ interval_minutes: Number.NaN })).toBe("schedule unknown");

    const now = Date.now();
    expect(timeAgo(now - 10_000, now)).toBe("just now");
    expect(timeAgo(now - 5 * 60_000, now)).toBe("5m ago");
    expect(timeAgo(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(timeAgo(now - 2 * 86_400_000, now)).toBe("2d ago");
  });
});
