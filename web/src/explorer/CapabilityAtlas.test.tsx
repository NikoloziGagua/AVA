import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExplorerTaskSummary } from "../api.js";
import { CapabilityAtlas } from "./CapabilityAtlas.js";
import {
  EXPLORER_CAPABILITIES,
  EXPLORER_DOMAINS,
} from "./registry.js";

afterEach(cleanup);

describe("Capability Atlas navigation", () => {
  it("provides a persistent capability to domain to map return path", () => {
    function NavigationHarness() {
      const [domainId, setDomainId] = useState<string | null>("browser");
      const [capabilityId, setCapabilityId] = useState<string | null>(
        "browser.persistent-control",
      );
      return (
        <CapabilityAtlas
          domains={EXPLORER_DOMAINS}
          capabilities={EXPLORER_CAPABILITIES}
          runtime={[]}
          tasks={[]}
          query=""
          depth="overview"
          selectedDomainId={domainId}
          selectedCapabilityId={capabilityId}
          onSelectDomain={(id) => {
            setDomainId(id);
            setCapabilityId(null);
          }}
          onSelectCapability={setCapabilityId}
          onBackToMap={() => {
            setDomainId(null);
            setCapabilityId(null);
          }}
          onBackToDomain={() => setCapabilityId(null)}
          onOpenTask={() => undefined}
          onLaunch={() => undefined}
        />
      );
    }

    render(<NavigationHarness />);

    expect(screen.getByRole("navigation", { name: "Atlas breadcrumb" })).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Back to Browser automation" }),
    );

    expect(
      screen.getByRole("heading", { name: "Browser automation" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Back to full system map" }),
    );

    expect(screen.getByText("Capability atlas")).toBeTruthy();
  });

  it("returns directly to the system map from a capability breadcrumb", () => {
    const onBackToMap = vi.fn();
    render(
      <CapabilityAtlas
        domains={EXPLORER_DOMAINS}
        capabilities={EXPLORER_CAPABILITIES}
        runtime={[]}
        tasks={[]}
        query=""
        depth="overview"
        selectedDomainId="browser"
        selectedCapabilityId="browser.persistent-control"
        onSelectDomain={() => undefined}
        onSelectCapability={() => undefined}
        onBackToMap={onBackToMap}
        onBackToDomain={() => undefined}
        onOpenTask={() => undefined}
        onLaunch={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "System map" }));
    expect(onBackToMap).toHaveBeenCalledOnce();
  });

  it("opens an observed task from its capability detail page", () => {
    const onOpenTask = vi.fn();
    const task: ExplorerTaskSummary = {
      id: "task-browser-1",
      sessionId: "session-1",
      sessionTitle: "Open AVA Chrome",
      status: "finished",
      outcome: "finished_unverified",
      mode: "action",
      verification: {
        status: "not_recorded",
        reason: "No structured verification event was emitted.",
      },
      startedAt: 1,
      completedAt: 2,
      durationMs: 1,
      eventCount: 3,
      toolCallCount: 1,
      errorCount: 0,
      capabilityIds: ["browser.persistent-control"],
      evidence: { source: "instrumented_runtime", label: "observed" },
    };

    render(
      <CapabilityAtlas
        domains={EXPLORER_DOMAINS}
        capabilities={EXPLORER_CAPABILITIES}
        runtime={[]}
        tasks={[task]}
        query=""
        depth="overview"
        selectedDomainId="browser"
        selectedCapabilityId="browser.persistent-control"
        onSelectDomain={() => undefined}
        onSelectCapability={() => undefined}
        onBackToMap={() => undefined}
        onBackToDomain={() => undefined}
        onOpenTask={onOpenTask}
        onLaunch={() => undefined}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open task Open AVA Chrome" }),
    );

    expect(onOpenTask).toHaveBeenCalledWith("task-browser-1");
  });
});
