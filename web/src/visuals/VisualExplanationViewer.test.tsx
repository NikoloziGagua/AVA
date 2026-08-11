// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/useReducedMotion.js", () => ({ useReducedMotion: () => true }));

import { visualFixture } from "./fixtures.test-helper.js";
import { VisualMessageCard } from "./VisualMessageCard.js";

const inertSvg = async (_source: string, _id: string, title: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg"><title>${title}</title><rect width="20" height="20" /></svg>`;

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("VisualMessageCard", () => {
  it("renders natively, honors reduced motion, and supports accessible keyboard scene navigation", async () => {
    const renderSvg = vi.fn(inertSvg);
    render(<VisualMessageCard visual={visualFixture} render={renderSvg} />);

    const card = screen.getByLabelText("Request path visual explanation, revision 1");
    expect(screen.queryByTitle(/Request path:/)).toBeNull();
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.getAllByText("AVA interprets and routes the request.").length).toBeGreaterThan(0);
    expect(await screen.findByTestId("native-visual-svg")).toBeTruthy();
    expect(renderSvg.mock.calls[0]?.[0]).not.toContain("Verified?");
    expect(screen.getByTestId("native-visual-svg").className).not.toContain("transition-transform");

    fireEvent.keyDown(card, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getAllByText("AVA reports what evidence actually proves.").length).toBeGreaterThan(0));
    expect(renderSvg.mock.calls.at(-1)?.[0]).toContain("Verified?");
    fireEvent.keyDown(card, { key: "+" });
    expect(screen.getByText("115%")).toBeTruthy();
    fireEvent.keyDown(card, { key: "0" });
    expect(screen.getByText("100%")).toBeTruthy();
    expect(screen.getByText("Accessible text version")).toBeTruthy();
    expect(screen.getByText(/Verified\? — Yes or no — Report result/)).toBeTruthy();
  });

  it("re-sanitizes renderer output at the native injection boundary", async () => {
    const hostile = async () => `<svg xmlns="http://www.w3.org/2000/svg" onclick="steal()">
      <script>steal()</script><foreignObject><div>generated html</div></foreignObject>
      <a href="https://evil.test"><text>network link</text></a><rect style="fill:red;background:url(https://evil.test/x)" />
    </svg>`;
    render(<VisualMessageCard visual={visualFixture} render={hostile} />);
    const host = await screen.findByTestId("native-visual-svg");
    expect(host.innerHTML).not.toMatch(/script|foreignObject|onclick|https:\/\/evil|href=/i);
    expect(host.querySelector("svg")?.getAttribute("role")).toBe("img");
    expect(host.querySelector("svg")?.getAttribute("aria-labelledby")).toMatch(/ava-visual-title-/);
  });

  it("keeps view changes local and sends exact structured context only through explicit actions", async () => {
    const onAction = vi.fn();
    const { container } = render(<div className="soft-scrollbar"><VisualMessageCard visual={visualFixture} render={inertSvg} onSemanticAction={onAction} /></div>);
    const scroller = container.querySelector(".soft-scrollbar") as HTMLElement;
    scroller.scrollTop = 137;
    await screen.findByTestId("native-visual-svg");

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    fireEvent.click(screen.getByRole("button", { name: "Route request" }));
    expect(onAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Ask AVA about this branch" }));
    expect(onAction).toHaveBeenCalledWith({
      visualMessageId: "visual_fixture01",
      revision: 1,
      action: "branch",
      sceneId: "routeScene",
      selectedElementIds: ["route"],
    }, visualFixture);

    fireEvent.click(screen.getByRole("button", { name: "Next scene" }));
    await waitFor(() => expect(screen.getAllByText("AVA reports what evidence actually proves.").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: "Verified?" }));
    fireEvent.click(screen.getByRole("button", { name: "Expand visual inside AVA" }));
    scroller.scrollTop = 420;
    const dialog = screen.getByRole("dialog", { name: "Expanded Request path" });
    expect(within(dialog).getByText("100%")).toBeTruthy();
    expect(within(dialog).getAllByText("AVA reports what evidence actually proves.").length).toBeGreaterThan(0);
    expect(within(dialog).getByRole("button", { name: "Verified?" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close expanded visual" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(scroller.scrollTop).toBe(137);
    expect(screen.getByRole("button", { name: "Verified?" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("handles multiple narrow inline visuals, unique accessibility IDs, export readiness, and render fallback", async () => {
    const second = { ...visualFixture, visualMessageId: "visual_fixture02", title: "Second path" };
    const { rerender } = render(
      <div style={{ width: 320 }}>
        <VisualMessageCard visual={visualFixture} render={inertSvg} />
        <VisualMessageCard visual={second} render={inertSvg} />
      </div>,
    );
    await waitFor(() => expect(screen.getAllByTestId("native-visual-svg")).toHaveLength(2));
    expect(screen.getAllByTestId("visual-message-card")).toHaveLength(2);
    const labels = [...document.querySelectorAll('svg[role="img"]')].map((svg) => svg.getAttribute("aria-labelledby"));
    expect(new Set(labels).size).toBe(2);
    expect((screen.getAllByRole("button", { name: "SVG" })[0] as HTMLButtonElement).disabled).toBe(false);

    rerender(<VisualMessageCard visual={visualFixture} render={async () => { throw new Error("renderer unavailable"); }} />);
    expect((await screen.findByRole("alert")).textContent).toContain("renderer unavailable");
    expect(screen.getByText("Accessible text version")).toBeTruthy();
  });
});
