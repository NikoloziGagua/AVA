// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EXPLORER_CAPABILITIES, EXPLORER_DOMAINS } from "./registry.js";
import { DiscoverView, DISCOVER_PILLARS } from "./DiscoverView.js";

afterEach(cleanup);

describe("Explorer Discover view", () => {
  it("only showcases capability IDs that exist in AVA's real registry", () => {
    const real = new Set(EXPLORER_CAPABILITIES.map((capability) => capability.id));
    const advertised = DISCOVER_PILLARS.flatMap((pillar) => [
      ...pillar.capabilityIds,
      ...pillar.examples.map((example) => example.capabilityId),
    ]);
    expect(advertised.length).toBeGreaterThan(15);
    expect(advertised.filter((id) => !real.has(id))).toEqual([]);
  });

  it("makes AVA understandable, progressively reveals outcomes, and launches real examples without exposing Forge", () => {
    const onLaunch = vi.fn();
    const onInspectCapability = vi.fn();
    render(
      <DiscoverView
        domains={EXPLORER_DOMAINS}
        capabilities={EXPLORER_CAPABILITIES}
        runtime={[]}
        taskTotal={7}
        loading={false}
        onLaunch={onLaunch}
        onInspectCapability={onInspectCapability}
        onOpenMap={() => undefined}
        onOpenActivity={() => undefined}
      />,
    );

    expect(screen.getByRole("heading", { name: /AVA CAN ACT\. REMEMBER\. PROVE\./i })).toBeTruthy();
    expect(screen.getByText("Uses Windows and the web")).toBeTruthy();
    expect(screen.getByText("Remembers source-linked context")).toBeTruthy();

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining("Talk"),
      expect.stringContaining("Use my PC"),
      expect.stringContaining("Use accounts"),
      expect.stringContaining("Remember"),
      expect.stringContaining("Build"),
    ]));
    fireEvent.click(screen.getByRole("tab", { name: /Talk/i }));
    expect(screen.getByRole("heading", { name: "Talk naturally" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /Use accounts/i }));
    expect(screen.getByRole("heading", { name: "Work through your accounts" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /Remember/i }));
    expect(screen.getByRole("heading", { name: "Remember and organise" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /Build/i }));
    expect(screen.getByRole("heading", { name: "Build, automate and improve" })).toBeTruthy();
    expect(screen.queryByText(/forge/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Open my working browser/i }));
    expect(onLaunch).toHaveBeenCalledWith("Open AVA Chrome and show me which tabs are open.");

    fireEvent.click(screen.getByRole("tab", { name: /Talk/i }));
    fireEvent.click(screen.getByRole("button", { name: /Text chat/i }));
    expect(onInspectCapability).toHaveBeenCalledWith("conversation.text-turn");
  });

  it("moves between outcome chapters with arrow, Home, and End keys", () => {
    render(
      <DiscoverView
        domains={EXPLORER_DOMAINS}
        capabilities={EXPLORER_CAPABILITIES}
        runtime={[]}
        taskTotal={0}
        loading={false}
        onLaunch={() => undefined}
        onInspectCapability={() => undefined}
        onOpenMap={() => undefined}
        onOpenActivity={() => undefined}
      />,
    );

    const computer = screen.getByRole("tab", { name: /Use my PC/i });
    computer.focus();
    fireEvent.keyDown(computer, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: /Use accounts/i }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(screen.getByRole("tab", { name: /Use accounts/i }), { key: "End" });
    expect(screen.getByRole("tab", { name: /Build/i }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(screen.getByRole("tab", { name: /Build/i }), { key: "Home" });
    expect(screen.getByRole("tab", { name: /Talk/i }).getAttribute("aria-selected")).toBe("true");
  });

  it("opens capability evidence instead of launching a known unavailable example", () => {
    const onLaunch = vi.fn();
    const onInspectCapability = vi.fn();
    render(
      <DiscoverView
        domains={EXPLORER_DOMAINS}
        capabilities={EXPLORER_CAPABILITIES}
        runtime={[{
          id: "browser",
          domainId: "browser",
          name: "Browser",
          description: "Persistent browser",
          stability: "stable",
          moduleReference: "server/src/tools/chrome.ts",
          dependencies: [],
          verificationMethods: [],
          readiness: "setup_required",
          health: "unavailable",
          reason: "Browser runtime is not configured.",
          statusConfidence: "high",
          lastChecked: 2_000,
          evidence: [],
        }]}
        taskTotal={0}
        loading={false}
        onLaunch={onLaunch}
        onInspectCapability={onInspectCapability}
        onOpenMap={() => undefined}
        onOpenActivity={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Open my working browser/i }));
    expect(onLaunch).not.toHaveBeenCalled();
    expect(onInspectCapability).toHaveBeenCalledWith("browser.persistent-control");
  });
});
