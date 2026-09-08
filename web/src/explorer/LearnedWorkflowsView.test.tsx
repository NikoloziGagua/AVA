import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ExplorerLearnedWorkflow,
  ExplorerLearnedWorkflowsResponse,
} from "../api.js";
import { LearnedWorkflowsView } from "./LearnedWorkflowsView.js";

const workflow = (
  patch: Partial<ExplorerLearnedWorkflow> = {},
): ExplorerLearnedWorkflow => ({
  id: "playbook:open-ava-browser",
  slug: "open-ava-browser",
  trigger: "Open AVA Chrome",
  keywords: ["chrome", "browser"],
  stakes: "routine",
  revision: 3,
  created: "2026-07-20T12:00:00.000Z",
  lastUsed: "2026-07-25T12:00:00.000Z",
  steps: [
    {
      id: "playbook:open-ava-browser:step:1",
      sequence: 1,
      label: "Start the persistent AVA browser profile",
      source: "stored_playbook_step",
    },
    {
      id: "playbook:open-ava-browser:step:2",
      sequence: 2,
      label: "Verify the Chrome window is visible",
      source: "stored_playbook_step",
    },
  ],
  lessons: ["Keep the persistent AVA profile separate from the personal profile."],
  metrics: {
    recalls: 12,
    verifiedRuns: 8,
    partiallyVerifiedRuns: 0,
    unverifiedRuns: 1,
    contradictedRuns: 1,
    failedRuns: 0,
    evidenceOutcomes: 10,
    verificationRate: 0.8,
    averageVerifiedDurationMs: 11_000,
    legacyReportedFinals: 8,
    legacyRuntimeFailures: 2,
  },
  evidenceState: "verified_outcomes",
  provenance: {
    source: "procedural_memory_playbook",
    sourceId: "open-ava-browser",
    storedDefinition: true,
    creationMethod: "not_recorded",
    metricsSource: "verified_learning_gate",
    note: "Creation method is not retained by the current playbook schema.",
  },
  capabilityMapping: {
    status: "not_recorded",
    capabilityIds: [],
    reason: "The playbook does not persist capability identifiers.",
  },
  taskLinkage: {
    status: "not_recorded",
    taskIds: [],
    reason: "Historical playbook recalls are not linked to Explorer task IDs.",
  },
  ...patch,
});

const response = (
  workflows: ExplorerLearnedWorkflow[],
): ExplorerLearnedWorkflowsResponse => ({
  workflows,
  summary: {
    total: workflows.length,
    withObservedOutcomes: workflows.filter(
      (item) => item.evidenceState === "verified_outcomes",
    ).length,
    definitionOnly: workflows.filter(
      (item) => item.evidenceState === "definition_only",
    ).length,
    totalRecalls: workflows.reduce((total, item) => total + item.metrics.recalls, 0),
    verifiedRuns: workflows.reduce((total, item) => total + item.metrics.verifiedRuns, 0),
    partiallyVerifiedRuns: workflows.reduce((total, item) => total + item.metrics.partiallyVerifiedRuns, 0),
    unverifiedRuns: workflows.reduce((total, item) => total + item.metrics.unverifiedRuns, 0),
    contradictedRuns: workflows.reduce((total, item) => total + item.metrics.contradictedRuns, 0),
    failedRuns: workflows.reduce((total, item) => total + item.metrics.failedRuns, 0),
    legacyReportedFinals: workflows.reduce((total, item) => total + item.metrics.legacyReportedFinals, 0),
    legacyRuntimeFailures: workflows.reduce((total, item) => total + item.metrics.legacyRuntimeFailures, 0),
  },
  source: {
    id: "procedural_memory_playbooks",
    type: "local_playbook_store",
    status: "available",
    parsedRecords: workflows.length,
    excludedUnparseableRecords: 0,
    readAt: 2_000,
    note: "Every returned workflow is a parseable local playbook.",
  },
  coverage: {
    capabilityLinksRecorded: false,
    taskLinksRecorded: false,
    note: "Capability and task links are not recorded by this schema.",
  },
  generatedAt: 2_000,
  apiVersion: 2,
});

afterEach(cleanup);

describe("Learned Workflows Explorer view", () => {
  it("renders every stored trigger and step as a top-down tree with lessons outside it", () => {
    const second = workflow({
      id: "playbook:send-update",
      slug: "send-update",
      trigger: "Send the daily update",
      steps: [
        {
          id: "playbook:send-update:step:1",
          sequence: 1,
          label: "Draft the update",
          source: "stored_playbook_step",
        },
      ],
      lessons: [],
      evidenceState: "definition_only",
      metrics: {
        recalls: 0,
        verifiedRuns: 0,
        partiallyVerifiedRuns: 0,
        unverifiedRuns: 0,
        contradictedRuns: 0,
        failedRuns: 0,
        evidenceOutcomes: 0,
        verificationRate: null,
        averageVerifiedDurationMs: null,
        legacyReportedFinals: 0,
        legacyRuntimeFailures: 0,
      },
    });

    render(
      <LearnedWorkflowsView
        response={response([workflow(), second])}
        loading={false}
        error={null}
        onRetry={() => undefined}
      />,
    );

    const browserTree = screen.getByRole("tree", {
      name: "Open AVA Chrome learned workflow",
    });
    expect(within(browserTree).getByLabelText("Trigger: Open AVA Chrome")).toBeTruthy();
    expect(
      within(browserTree).getByLabelText(
        "Stored step 1: Start the persistent AVA browser profile",
      ),
    ).toBeTruthy();
    expect(
      within(browserTree).getByLabelText(
        "Stored step 2: Verify the Chrome window is visible",
      ),
    ).toBeTruthy();

    const lessons = screen.getByRole("complementary", {
      name: "Open AVA Chrome lessons",
    });
    expect(
      within(lessons).getByText(
        "Keep the persistent AVA profile separate from the personal profile.",
      ),
    ).toBeTruthy();
    expect(
      within(browserTree).queryByText(
        "Keep the persistent AVA profile separate from the personal profile.",
      ),
    ).toBeNull();

    expect(
      screen.getByRole("tree", { name: "Send the daily update learned workflow" }),
    ).toBeTruthy();
    expect(screen.getAllByText("Capability links · Not recorded")).toHaveLength(2);
    expect(screen.getAllByText("Task links · Not recorded")).toHaveLength(2);
  });

  it("shows a confirmed empty store without inserting demo workflows", () => {
    render(
      <LearnedWorkflowsView
        response={response([])}
        loading={false}
        error={null}
        onRetry={() => undefined}
      />,
    );

    expect(screen.getByText("No durable playbooks yet")).toBeTruthy();
    expect(screen.queryAllByRole("tree")).toHaveLength(0);
  });

  it("shows the real load failure and retries through the supplied callback", () => {
    const onRetry = vi.fn();
    render(
      <LearnedWorkflowsView
        response={null}
        loading={false}
        error="HTTP 404: Explorer route not found. Restart AVA."
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText(/HTTP 404: Explorer route not found/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Retry learned workflows" }),
    );
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
