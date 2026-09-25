import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GodUiPreview } from "./GodUiPreview.js";

const media = (matches: boolean) => ({
  matches,
  media: "(prefers-reduced-motion: reduce)",
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
});

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("matchMedia", vi.fn(() => media(false)));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("GodUiPreview", () => {
  it("presents the supplied motion ideas as one AVA-specific concept", () => {
    render(<GodUiPreview />);
    expect(screen.getByTestId("godui-preview")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /everything important is under control/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /see AVA think/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /memory with shape/i })).toBeTruthy();
    expect(screen.getByText("Preview · no real actions")).toBeTruthy();
  });

  it("keeps every tactile demo explicit and reversible", () => {
    render(<GodUiPreview />);
    fireEvent.click(screen.getAllByRole("button", { name: /talk to AVA/i })[0]!);
    expect(screen.getAllByText("AVA").length).toBeGreaterThan(0);
    const quick = screen.getByRole("button", { name: "Open quick actions" });
    fireEvent.click(quick);
    expect(quick.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Idea" }));
    expect(screen.getByText("New idea selected.")).toBeTruthy();
  });

  it("supports progressive flow and note exploration with native buttons", () => {
    render(<GodUiPreview />);
    fireEvent.click(screen.getByRole("button", { name: "Next workflow stage" }));
    expect(screen.getByText("Stage 2 of 6")).toBeTruthy();
    const university = screen.getByRole("button", { name: /University 12 living notes/i });
    expect(university.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /AVA 8 active ideas/i }));
    expect(screen.getByRole("button", { name: /AVA 8 active ideas/i }).getAttribute("aria-expanded")).toBe("true");
  });
});
