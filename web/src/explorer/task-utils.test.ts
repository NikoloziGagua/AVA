import { describe, expect, it } from "vitest";
import type {
  ExplorerEvent,
  ExplorerTaskSummary,
} from "../api.js";
import {
  describeExplorerRequestError,
  filterExplorerTasks,
  explorerTaskStatusLabel,
  formatExplorerDuration,
  humanizeExplorerToken,
  selectInitialExplorerEvent,
  stringifyExplorerPayload,
} from "./task-utils.js";

const task = (patch: Partial<ExplorerTaskSummary> = {}): ExplorerTaskSummary => ({
  id: "task-123",
  sessionId: "session-1",
  sessionTitle: "Send a WhatsApp message",
  status: "finished",
  outcome: "Message sent",
  mode: "action",
  verification: { status: "verified", reason: "Message appeared in the thread" },
  startedAt: 1_000,
  completedAt: 2_000,
  durationMs: 1_000,
  eventCount: 4,
  toolCallCount: 1,
  errorCount: 0,
  capabilityIds: ["communication.whatsapp.send"],
  evidence: { source: "instrumented_runtime", label: "observed" },
  ...patch,
});

const event = (patch: Partial<ExplorerEvent> = {}): ExplorerEvent => ({
  id: 1,
  taskId: "task-123",
  sequence: 1,
  type: "task_started",
  title: "Task started",
  status: "success",
  occurredAt: 1_000,
  durationMs: 20,
  toolName: null,
  capabilityIds: [],
  input: null,
  output: null,
  error: null,
  privacyLevel: "normal",
  evidence: {
    source: "instrumented_runtime",
    proves: "The task runtime started",
    verification: "not_independently_verified",
  },
  ...patch,
});

describe("Explorer task helpers", () => {
  it("preserves request status and gives route-specific restart guidance", () => {
    const description = describeExplorerRequestError(
      { status: 404, message: "route not found" },
      "task history",
    );

    expect(description).toContain("HTTP 404: route not found");
    expect(description).toContain("Restart AVA");
  });

  it("filters across status, verification and capability IDs", () => {
    const tasks = [
      task(),
      task({
        id: "task-456",
        sessionTitle: "Research prices",
        status: "failed",
        verification: { status: "not_verified", reason: "Browser closed" },
        capabilityIds: ["browser.research"],
      }),
    ];

    expect(filterExplorerTasks(tasks, "whatsapp", "all", "all")).toEqual([tasks[0]]);
    expect(filterExplorerTasks(tasks, "", "failed", "not_verified")).toEqual([tasks[1]]);
    expect(filterExplorerTasks(tasks, "browser.research", "finished", "all")).toEqual([]);
  });

  it("formats measured durations without turning missing timing into zero", () => {
    expect(formatExplorerDuration(null)).toBe("Not recorded");
    expect(formatExplorerDuration(0)).toBe("0 ms");
    expect(formatExplorerDuration(1_250)).toBe("1.3 s");
    expect(formatExplorerDuration(65_000)).toBe("1m 5s");
  });

  it("prioritises a failed recorded event for inspection", () => {
    const events = [
      event(),
      event({ id: 2, sequence: 2, status: "error", error: "tool_failed" }),
    ];
    expect(selectInitialExplorerEvent(events)?.id).toBe(2);
    expect(selectInitialExplorerEvent([])).toBeNull();
  });

  it("uses the exact statuses emitted by the Explorer API", () => {
    const events = [
      event({ id: 1, status: "running" }),
      event({ id: 2, status: "success" }),
      event({ id: 3, status: "waiting" }),
      event({ id: 4, status: "approved" }),
      event({ id: 5, status: "denied" }),
    ];

    expect(selectInitialExplorerEvent(events)?.id).toBe(5);
  });

  it("renders tokens and payloads without altering recorded values", () => {
    expect(humanizeExplorerToken("partially_verified")).toBe("Partially Verified");
    expect(explorerTaskStatusLabel("finished")).toBe("Final response recorded");
    expect(explorerTaskStatusLabel("completed")).toBe("Legacy final response");
    expect(stringifyExplorerPayload({ redacted: true })).toBe(
      '{\n  "redacted": true\n}',
    );
    expect(stringifyExplorerPayload("already sanitised")).toBe("already sanitised");
  });
});
