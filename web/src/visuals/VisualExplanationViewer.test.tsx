// @vitest-environment jsdom
import { forwardRef } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/useReducedMotion.js", () => ({ useReducedMotion: () => true }));

import { visualFixture } from "./fixtures.test-helper.js";
import { VisualFlowCanvas, type VisualFlowCanvasProps } from "./VisualFlowCanvas.js";
import { VisualMessageCard } from "./VisualMessageCard.js";

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("VisualMessageCard with React Flow", () => {
  it("renders a real interactive graph, honors reduced motion, and preserves card keyboard scenes", async () => {
    render(<VisualMessageCard visual={visualFixture} />);

    const card = screen.getByLabelText("Request path visual explanation, revision 1");
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.getByTestId("visual-flow-canvas")).toBeTruthy();
    expect(screen.getByLabelText("Route request, process, highlighted")).toBeTruthy();
    expect(screen.queryByLabelText(/Verified\?, decision/)).toBeNull();
    expect(document.querySelector(".react-flow__edge.animated")).toBeNull();

    fireEvent.keyDown(card, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByLabelText("Verified?, decision, highlighted")).toBeTruthy());
    expect(screen.queryByLabelText(/Niko asks AVA, terminal/)).toBeNull();
    expect(screen.getByText("Accessible text version")).toBeTruthy();
    expect(screen.getByText(/Verified\?.*Yes or no.*Report result/)).toBeTruthy();
  });

  it("renders hostile semantic text as inert text and ignores renderer payload", () => {
    const hostile = {
      ...visualFixture,
      semanticModel: {
        ...visualFixture.semanticModel,
        elements: visualFixture.semanticModel.elements.map((element) => element.id === "route"
          ? { ...element, label: '<img src=x onerror="steal()">Route' }
          : element),
      },
      renderer: { ...visualFixture.renderer, payload: '<script src="https://evil.test/x.js"></script>' },
    };
    const { container } = render(<VisualMessageCard visual={hostile} />);
    expect(screen.getByText('<img src=x onerror="steal()">Route')).toBeTruthy();
    expect(container.querySelector("script, iframe, foreignObject, img")).toBeNull();
    expect(container.innerHTML).not.toContain("evil.test");
  });

  it("keeps viewport operations local and sends structured context only through explicit actions", async () => {
    const onAction = vi.fn();
    const { container } = render(<div className="soft-scrollbar"><VisualMessageCard visual={visualFixture} onSemanticAction={onAction} /></div>);
    const scroller = container.querySelector(".soft-scrollbar") as HTMLElement;
    scroller.scrollTop = 137;

    fireEvent.click(screen.getByRole("button", { name: /zoom in/i }));
    expect(onAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Route request, process, highlighted"));
    await waitFor(() => expect(screen.getByText("2 connected relationships highlighted on the map.")).toBeTruthy());
    expect(onAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Ask about branch" }));
    expect(onAction).toHaveBeenCalledWith({
      visualMessageId: "visual_fixture01",
      revision: 1,
      action: "branch",
      sceneId: "routeScene",
      selectedElementIds: ["route"],
    }, visualFixture);

    fireEvent.click(screen.getByRole("button", { name: "Next scene" }));
    await waitFor(() => expect(screen.getByLabelText("Verified?, decision, highlighted")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Verified?, decision, highlighted"));
    await waitFor(() => expect(screen.getByText("Verified?")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Expand visual inside AVA" }));
    scroller.scrollTop = 420;
    const dialog = screen.getByRole("dialog", { name: "Expanded Request path" });
    expect(within(dialog).getByLabelText("Verified?, decision, highlighted").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close expanded visual" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(scroller.scrollTop).toBe(137);
    expect(screen.getByLabelText("Verified?, decision, highlighted").getAttribute("aria-pressed")).toBe("true");
  });

  it("supports multiple narrow visuals, export, and an accessible static fallback", async () => {
    const second = { ...visualFixture, visualMessageId: "visual_fixture02", title: "Second path" };
    const exporter = vi.fn(async () => undefined);
    const { rerender } = render(
      <div style={{ width: 320 }}>
        <VisualMessageCard visual={visualFixture} exporter={exporter} />
        <VisualMessageCard visual={second} exporter={exporter} />
      </div>,
    );
    expect(screen.getAllByTestId("visual-flow-canvas")).toHaveLength(2);
    expect(screen.getAllByTestId("visual-message-card")).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "SVG" })[0]!);
    await waitFor(() => expect(exporter).toHaveBeenCalledWith(expect.any(HTMLElement), "svg", "Request path", "Route"));

    const BrokenCanvas = forwardRef<HTMLDivElement, VisualFlowCanvasProps>(function BrokenCanvas() {
      throw new Error("isolated renderer failure");
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    rerender(<VisualMessageCard visual={visualFixture} canvasComponent={BrokenCanvas as typeof VisualFlowCanvas} />);
    expect(screen.getByRole("alert").textContent).toContain("could not be displayed");
    expect(screen.getByText("Accessible text version")).toBeTruthy();
  });
});
