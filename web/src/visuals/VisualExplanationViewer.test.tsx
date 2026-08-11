// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/useReducedMotion.js", () => ({ useReducedMotion: () => true }));
vi.mock("motion/react", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    motion: { div: ({ children, initial: _i, animate: _a, exit: _e, transition: _t, ...props }: any) => <div {...props}>{children}</div> },
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  };
});

import { visualFixture } from "./fixtures.test-helper.js";
import { VisualExplanationViewer } from "./VisualExplanationViewer.js";

afterEach(cleanup);

describe("VisualExplanationViewer", () => {
  it("renders captions in a restrictive sandbox and supports keyboard scene navigation", async () => {
    const renderSvg = vi.fn(async (_source: string, _id: string, title: string) =>
      `<svg xmlns="http://www.w3.org/2000/svg" role="img"><title>${title}</title><rect width="20" height="20" /></svg>`);
    render(<VisualExplanationViewer visual={visualFixture} render={renderSvg} />);

    expect(screen.getAllByText("AVA interprets and routes the request.").length).toBeGreaterThan(0);
    const frame = await screen.findByTitle("Request path: Route");
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame.getAttribute("srcdoc")).toContain("script-src 'none'");
    expect(renderSvg.mock.calls[0]?.[0]).not.toContain("Verified?");

    const viewer = screen.getByLabelText("Request path visual walkthrough");
    fireEvent.keyDown(viewer, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getAllByText("AVA reports what evidence actually proves.").length).toBeGreaterThan(0));
    expect(await screen.findByTitle("Request path: Verify")).toBeTruthy();
    expect(renderSvg.mock.calls.at(-1)?.[0]).toContain("Verified?");
  });

  it("provides a complete accessible static fallback and honest export controls", async () => {
    render(<VisualExplanationViewer visual={visualFixture} render={async () => "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"} />);
    expect(screen.getByText("Accessible text version")).toBeTruthy();
    expect(screen.getByText(/Route request/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /SVG/i }) as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect((screen.getByRole("button", { name: /SVG/i }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByText(/Sandboxed static SVG/)).toBeTruthy();
  });
});
