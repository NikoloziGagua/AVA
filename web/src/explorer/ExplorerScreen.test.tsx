import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  fetchExplorerRuntimeCapabilities: vi.fn(),
  fetchExplorerTasks: vi.fn(),
  fetchExplorerLearnedWorkflows: vi.fn(),
}));

vi.mock("../api.js", () => ({
  fetchExplorerRuntimeCapabilities: apiMocks.fetchExplorerRuntimeCapabilities,
  fetchExplorerTasks: apiMocks.fetchExplorerTasks,
  fetchExplorerLearnedWorkflows: apiMocks.fetchExplorerLearnedWorkflows,
}));

vi.mock("../components/ava/PanelShell.js", () => ({
  PanelShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("./index.js", () => ({
  EXPLORER_CAPABILITIES: [],
  EXPLORER_DOMAINS: [],
  getCapability: () => undefined,
}));

vi.mock("./CapabilityAtlas.js", () => ({
  CapabilityAtlas: ({
    selectedDomainId,
    selectedCapabilityId,
    onSelectDomain,
    onSelectCapability,
  }: {
    selectedDomainId: string | null;
    selectedCapabilityId: string | null;
    onSelectDomain: (id: string) => void;
    onSelectCapability: (id: string) => void;
  }) => (
    <div>
      <span data-testid="atlas-selection">
        {selectedDomainId ?? "map"} / {selectedCapabilityId ?? "none"}
      </span>
      <button
        type="button"
        onClick={() => {
          onSelectDomain("browser");
          onSelectCapability("browser.persistent-control");
        }}
      >
        Drill into browser
      </button>
    </div>
  ),
}));

vi.mock("./HealthView.js", () => ({ HealthView: () => <div>Health view</div> }));
vi.mock("./LiveTasksView.js", () => ({ LiveTasksView: () => <div>Live view</div> }));
vi.mock("./TaskInspector.js", () => ({ TaskInspector: () => <div>Task view</div> }));

import { ExplorerScreen } from "./ExplorerScreen.js";

const learnedResponse = {
  workflows: [
    {
      id: "playbook:test",
      slug: "test",
      trigger: "Run my learned routine",
      keywords: ["routine"],
      stakes: "routine" as const,
      revision: 1,
      created: null,
      lastUsed: null,
      steps: [
        {
          id: "playbook:test:step:1",
          sequence: 1,
          label: "Perform the stored action",
          source: "stored_playbook_step" as const,
        },
      ],
      lessons: [],
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
      evidenceState: "definition_only" as const,
      provenance: {
        source: "procedural_memory_playbook" as const,
        sourceId: "test",
        storedDefinition: true as const,
        creationMethod: "not_recorded" as const,
        metricsSource: "verified_learning_gate" as const,
        note: "Creation method is not recorded.",
      },
      capabilityMapping: {
        status: "not_recorded" as const,
        capabilityIds: [] as [],
        reason: "No capability IDs are stored.",
      },
      taskLinkage: {
        status: "not_recorded" as const,
        taskIds: [] as [],
        reason: "No task IDs are stored.",
      },
    },
  ],
  summary: {
    total: 1,
    withObservedOutcomes: 0,
    definitionOnly: 1,
    totalRecalls: 0,
    verifiedRuns: 0,
    partiallyVerifiedRuns: 0,
    unverifiedRuns: 0,
    contradictedRuns: 0,
    failedRuns: 0,
    legacyReportedFinals: 0,
    legacyRuntimeFailures: 0,
  },
  source: {
    id: "procedural_memory_playbooks" as const,
    type: "local_playbook_store" as const,
    status: "available" as const,
    parsedRecords: 1,
    excludedUnparseableRecords: 0,
    readAt: 2_000,
    note: "One parseable record.",
  },
  coverage: {
    capabilityLinksRecorded: false as const,
    taskLinksRecorded: false as const,
    note: "Links are not recorded.",
  },
  generatedAt: 2_000,
  apiVersion: 2,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Explorer learned workflow integration", () => {
  it("starts at Discover, keeps learned evidence under Activity, and resets the Map from its top tab", async () => {
    apiMocks.fetchExplorerRuntimeCapabilities.mockResolvedValue({
      domains: [],
      capabilities: [],
      generatedAt: 2_000,
      sources: [],
    });
    apiMocks.fetchExplorerTasks.mockResolvedValue({
      tasks: [],
      total: 0,
      limit: 100,
      offset: 0,
      hasMore: false,
      coverage: {
        source: "instrumented_runtime",
        historicalBackfill: false,
        note: "Only new runs.",
      },
      generatedAt: 2_000,
      apiVersion: 2,
    });
    apiMocks.fetchExplorerLearnedWorkflows.mockResolvedValue(learnedResponse);

    render(<ExplorerScreen onLaunch={() => undefined} />);

    await waitFor(() => {
      expect(apiMocks.fetchExplorerLearnedWorkflows).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByText(/One conversation\. Your computer, accounts, memory and projects/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    fireEvent.click(screen.getByRole("button", { name: "Drill into browser" }));
    expect(screen.getByTestId("atlas-selection").textContent).toContain(
      "browser / browser.persistent-control",
    );

    fireEvent.click(screen.getByRole("button", { name: "Activity" }));
    fireEvent.click(screen.getByRole("button", { name: /Learned workflows/i }));
    // The playbook title legitimately appears more than once (the card heading
    // and its trigger line), so assert presence rather than uniqueness.
    expect((await screen.findAllByText("Run my learned routine")).length).toBeGreaterThan(0);

    window.dispatchEvent(new Event("focus"));
    await waitFor(() => {
      expect(apiMocks.fetchExplorerLearnedWorkflows).toHaveBeenCalledTimes(2);
    });

    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    expect(screen.getByTestId("atlas-selection").textContent).toContain("map / none");
  });
});
