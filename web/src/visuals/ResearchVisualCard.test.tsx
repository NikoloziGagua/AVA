// @vitest-environment jsdom
import { forwardRef } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/useReducedMotion.js", () => ({ useReducedMotion: () => true }));

import { ResearchVisualCard } from "./ResearchVisualCard.js";
import { researchFixtureForForm, researchMapFixture } from "./research-fixtures.test-helper.js";

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("ResearchVisualCard", () => {
  it("renders genuine geography with routes, time layers, attribution and progressive scenes", async () => {
    const { container } = render(<ResearchVisualCard visual={researchMapFixture} />);
    expect(screen.getByTestId("research-map-canvas")).toBeTruthy();
    expect(container.querySelector("iframe, script, foreignObject")).toBeNull();
    expect(container.querySelectorAll("svg path").length).toBeGreaterThan(4);
    expect(screen.getByRole("img", { name: /geographic map/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Natural Earth/ }).getAttribute("href")).toBe("https://www.naturalearthdata.com/about/terms-of-use/");
    expect(within(screen.getByLabelText("Sources for this scene")).getByRole("link", { name: /Viking migration atlas/ }).getAttribute("href")).toBe("https://example.org/vikings");
    expect(screen.getByRole("button", { name: /Western route, forward route/ })).toBeTruthy();
    fireEvent.keyDown(screen.getByLabelText(/Viking migrations, Geographic map/), { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByText("Later movement extended into Iceland.")).toBeTruthy());
  });

  it("shows claim-level provenance and sends context only through explicit actions", () => {
    const onAction = vi.fn();
    render(<ResearchVisualCard visual={researchMapFixture} onSemanticAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: "Atlantic movement · 9th–10th centuries" }));
    expect(onAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Western movement · 8th–9th centuries" }));
    fireEvent.click(screen.getByRole("button", { name: /Western route, forward route/ }));
    expect(screen.getByText("Claim: Western migration connected Scandinavia, Britain and Iceland.")).toBeTruthy();
    const source = screen.getAllByRole("link", { name: /Viking migration atlas/ })[0]!;
    expect(source.getAttribute("href")).toBe("https://example.org/vikings");
    expect(source.getAttribute("rel")).toBe("noopener noreferrer");
    fireEvent.click(screen.getByRole("button", { name: "Ask about selection" }));
    expect(onAction).toHaveBeenCalledWith({ visualMessageId: "visual_research01", revision: 1, action: "branch", sceneId: "westScene", selectedElementIds: ["westRoute"] }, researchMapFixture);
  });

  it("supports inline expansion, keyboard return, accessible fallback and export", async () => {
    const exporter = vi.fn(async () => undefined);
    const { container } = render(<div className="soft-scrollbar"><ResearchVisualCard visual={researchMapFixture} exporter={exporter} /></div>);
    const scroller = container.querySelector(".soft-scrollbar") as HTMLElement;
    scroller.scrollTop = 91;
    fireEvent.click(screen.getByRole("button", { name: "Expand research visual inside AVA" }));
    const dialog = screen.getByRole("dialog", { name: "Expanded Viking migrations" });
    expect(within(dialog).getByTestId("research-map-canvas")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close expanded research visual" }));
    expect(scroller.scrollTop).toBe(91);
    fireEvent.click(screen.getByText("Accessible text and source panel"));
    expect(screen.getAllByText(/Movement from Scandinavia toward Britain/).length).toBeGreaterThan(1);
    fireEvent.click(screen.getByRole("button", { name: "SVG" }));
    await waitFor(() => expect(exporter).toHaveBeenCalledWith(expect.any(HTMLElement), "svg", "Viking migrations", "Westward"));
  });

  it("renders multiple narrow visuals without shared selection state", () => {
    const second = { ...researchMapFixture, visualMessageId: "visual_research02", title: "Second migration map" };
    render(<div style={{ width: 320 }}><ResearchVisualCard visual={researchMapFixture} /><ResearchVisualCard visual={second} /></div>);
    expect(screen.getAllByTestId("research-visual-card")).toHaveLength(2);
    expect(screen.getAllByTestId("research-map-canvas")).toHaveLength(2);
  });

  it("renders every specialized research form through the shared card", async () => {
    const forms = ["timeline", "evidence_matrix", "claim_evidence_graph", "chart", "process"] as const;
    for (const form of forms) {
      const { unmount } = render(<ResearchVisualCard visual={researchFixtureForForm(form)} />);
      const expected = form === "evidence_matrix" ? "research-matrix-canvas"
        : form === "claim_evidence_graph" || form === "process" ? "visual-flow-canvas"
        : `research-${form}-canvas`;
      await waitFor(() => expect(screen.getByTestId(expected)).toBeTruthy());
      unmount();
    }
  });

  it("keeps an accessible static fallback when a specialized renderer fails", () => {
    const Broken = forwardRef<HTMLDivElement>(function Broken() { throw new Error("renderer unavailable"); });
    render(<ResearchVisualCard visual={researchMapFixture} canvasComponent={Broken as any} />);
    expect(screen.getByRole("alert").textContent).toContain("Interactive visual unavailable");
    expect(screen.getAllByText("Scandinavia").length).toBeGreaterThan(0);
  });
});
