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

  it("makes AVA understandable and launches real examples without exposing Forge", () => {
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

    expect(screen.getByText("Talk naturally")).toBeTruthy();
    expect(screen.getByText("Control my computer")).toBeTruthy();
    expect(screen.getByText("Use my web and accounts")).toBeTruthy();
    expect(screen.getByText("Remember and organise")).toBeTruthy();
    expect(screen.getByText("Build and automate")).toBeTruthy();
    expect(screen.queryByText(/forge/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Open my working browser/i }));
    expect(onLaunch).toHaveBeenCalledWith("Open AVA Chrome and show me which tabs are open.");

    fireEvent.click(screen.getByRole("button", { name: /Text chat/i }));
    expect(onInspectCapability).toHaveBeenCalledWith("conversation.text-turn");
  });
});
