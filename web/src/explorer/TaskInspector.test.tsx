import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ExplorerTaskCoverage,
  ExplorerTaskDetail,
  ExplorerTaskSummary,
} from "../api.js";

const mocks = vi.hoisted(() => ({
  fetchExplorerTasks: vi.fn(),
  fetchExplorerTask: vi.fn(),
}));

vi.mock("../api.js", () => ({
  fetchExplorerTasks: mocks.fetchExplorerTasks,
  fetchExplorerTask: mocks.fetchExplorerTask,
}));

import { TaskInspector } from "./TaskInspector.js";

const coverage: ExplorerTaskCoverage = {
  source: "instrumented_runtime",
  historicalBackfill: false,
  note: "Only instrumented runs are shown.",
};

const summary: ExplorerTaskSummary = {
  id: "task-server-shaped",
  sessionId: "session-1",
  sessionTitle: "Inspect browser task",
  status: "finished",
  outcome: "finished_with_errors_unverified",
  mode: "action",
  verification: {
    status: "not_recorded",
    reason: "No independent verification event was recorded.",
  },
  startedAt: 1_000,
  completedAt: 2_000,
  durationMs: 1_000,
  eventCount: 3,
  toolCallCount: 1,
  errorCount: 1,
  capabilityIds: ["browser.persistent-control"],
  evidence: { source: "instrumented_runtime", label: "observed",
  },
};

const detail: ExplorerTaskDetail = {
  ...summary,
  originalRequest: "Open AVA Chrome",
  finalResponse: "The runtime returned a response after the tool error.",
  error: null,
  coverage,
  events: [
    {
      id: 1,
      taskId: summary.id,
      sequence: 1,
      type: "tool_call_started",
      title: "Started chrome_open",
      status: "running",
      occurredAt: 1_100,
      durationMs: null,
      toolName: "chrome_open",
      capabilityIds: ["browser.persistent-control"],
      input: { url: "https://example.test" },
      output: null,
      error: null,
      privacyLevel: "personal",
      evidence: {
        source: "instrumented_runtime",
        proves: "AVA requested this tool operation",
        verification: "not_independently_verified",
      },
    },
    {
      id: 2,
      taskId: summary.id,
      sequence: 2,
      type: "tool_call_completed",
      title: "chrome_open completed",
      status: "success",
      occurredAt: 1_300,
      durationMs: 200,
      toolName: "chrome_open",
      capabilityIds: ["browser.persistent-control"],
      input: null,
      output: { opened: true },
      error: null,
      privacyLevel: "personal",
      evidence: {
        source: "instrumented_runtime",
        proves: "the tool returned this recorded result",
        verification: "not_independently_verified",
      },
    },
    {
      id: 3,
      taskId: summary.id,
      sequence: 3,
      type: "tool_call_completed",
      title: "chrome_snapshot failed",
      status: "error",
      occurredAt: 1_500,
      durationMs: 100,
      toolName: "chrome_snapshot",
      capabilityIds: ["browser.persistent-control"],
      input: null,
      output: null,
      error: "target closed",
      privacyLevel: "personal",
      evidence: {
        source: "instrumented_runtime",
        proves: "the tool returned this recorded result",
        verification: "not_independently_verified",
      },
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Task Inspector server contract", () => {
  it("shows HTTP status, restart guidance and an in-place retry for task history", async () => {
    mocks.fetchExplorerTasks
      .mockRejectedValueOnce({ status: 404, message: "Route GET:/api/explorer/tasks not found" })
      .mockResolvedValueOnce({
        tasks: [],
        coverage,
        total: 0,
        generatedAt: 2_000,
      });

    render(<TaskInspector refreshIntervalMs={0} />);

    await screen.findByText("Task records unavailable");
    expect(screen.getByText(/HTTP 404:/)).toBeTruthy();
    expect(screen.getByText(/Restart AVA/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Retry task history" }));
    await screen.findByText("No instrumented tasks yet");
    expect(mocks.fetchExplorerTasks).toHaveBeenCalledTimes(2);
  });

  it("offers retry and return controls when one task record cannot load", async () => {
    mocks.fetchExplorerTasks.mockResolvedValue({
      tasks: [summary],
      coverage,
      total: 1,
      generatedAt: 2_000,
    });
    mocks.fetchExplorerTask.mockRejectedValue({
      status: 500,
      message: "database is busy",
    });

    render(
      <TaskInspector
        initialTaskId={summary.id}
        refreshIntervalMs={0}
      />,
    );

    await screen.findByText("Execution record unavailable");
    expect(screen.getByText(/HTTP 500: database is busy/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry task record" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Back to task list" }));
    await screen.findByText("Select a recorded task");
  });

  it("renders runtime event statuses with the correct active, success and error tones", async () => {
    mocks.fetchExplorerTasks.mockResolvedValue({
      tasks: [summary],
      coverage,
      total: 1,
      generatedAt: 2_000,
    });
    mocks.fetchExplorerTask.mockResolvedValue({ task: detail });

    const onOpenCapability = vi.fn();
    const { container } = render(
      <TaskInspector
        initialTaskId={summary.id}
        refreshIntervalMs={0}
        onOpenCapability={onOpenCapability}
      />,
    );

    await screen.findByText("Started chrome_open");

    const running = container.querySelector('[data-event-status="running"] svg');
    const success = container.querySelector('[data-event-status="success"] svg');
    const error = container.querySelector('[data-event-status="error"] svg');
    expect(running?.classList.contains("animate-spin")).toBe(true);
    expect(success?.classList.contains("text-[var(--ac-live)]")).toBe(true);
    expect(error?.classList.contains("text-[var(--ac-stop)]")).toBe(true);
    expect(screen.getAllByText("Final response recorded").length).toBeGreaterThan(0);

    // The capability is offered from more than one place on the page (the task
    // header and the matching event row); either is a valid way in, so click
    // the first rather than demanding the page only offer it once.
    fireEvent.click(screen.getAllByRole("button", { name: "browser.persistent-control" })[0]!);
    await waitFor(() => {
      expect(onOpenCapability).toHaveBeenCalledWith("browser.persistent-control");
    });
  });

  it("loads task history beyond the first 100 records", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      ...summary,
      id: `task-${String(index).padStart(3, "0")}`,
      sessionTitle: `Recorded task ${index}`,
      startedAt: 2_000 - index,
    }));
    const lastTask = {
      ...summary,
      id: "task-100",
      sessionTitle: "Oldest recorded task",
      startedAt: 1,
    };
    mocks.fetchExplorerTasks.mockImplementation(
      async (options: { offset?: number }) => ({
        tasks: options.offset === 100 ? [lastTask] : firstPage,
        coverage,
        total: 101,
        limit: 100,
        offset: options.offset ?? 0,
        hasMore: options.offset !== 100,
        generatedAt: 2_000,
      }),
    );
    mocks.fetchExplorerTask.mockImplementation(async (id: string) => ({
      task: {
        ...detail,
        id,
        events: detail.events.map((event) => ({ ...event, taskId: id })),
      },
    }));

    render(<TaskInspector refreshIntervalMs={0} />);

    await screen.findByText(/100 of 101 loaded/);
    fireEvent.click(
      screen.getByRole("button", { name: /Load older tasks/ }),
    );

    await screen.findByText(/101 of 101 loaded/);
    expect(mocks.fetchExplorerTasks).toHaveBeenCalledWith({
      limit: 100,
      offset: 100,
    });
  });
});
