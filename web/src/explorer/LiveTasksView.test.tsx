import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchExplorerLive: vi.fn(),
}));

vi.mock("../api.js", () => ({
  fetchExplorerLive: mocks.fetchExplorerLive,
}));

import { LiveTasksView } from "./LiveTasksView.js";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Live Tasks availability", () => {
  it("explains a stale Explorer route and recovers through the retry control", async () => {
    mocks.fetchExplorerLive
      .mockRejectedValueOnce({
        status: 404,
        message: "Route GET:/api/explorer/live not found",
      })
      .mockResolvedValueOnce({
        tasks: [],
        generatedAt: 2_000,
        source: "active_run_registry",
      });

    render(<LiveTasksView refreshIntervalMs={0} />);

    await screen.findByText("Live registry unavailable");
    expect(screen.getByText(/HTTP 404:/)).toBeTruthy();
    expect(screen.getByText(/Restart AVA/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Retry live registry" }));

    await screen.findByText("No AVA task is running now");
    expect(mocks.fetchExplorerLive).toHaveBeenCalledTimes(2);
  });
});
