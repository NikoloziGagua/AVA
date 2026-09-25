import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { advanceStars, createStars, projectStar, STAR_COUNT } from "./particles.js";
import { Starfield } from "./Starfield.js";

const state = vi.hoisted(() => ({ reduced: false }));
vi.mock("../motion.js", () => ({ useReducedMotion: () => state.reduced }));
vi.mock("../face/useDocumentLook.js", () => ({ useDocumentLook: () => "ink" }));
const frames = new Map<number, FrameRequestCallback>();
let next = 0;
const draw = { clearRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), setTransform: vi.fn(), globalAlpha: 1, fillStyle: "" };
beforeEach(() => {
  state.reduced = false; frames.clear(); next = 0;
  Object.values(draw).forEach(v => { if (typeof v === "function") v.mockClear(); });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(draw as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 800, height: 600 } as DOMRect);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frames.set(++next, cb); return next; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("metal starfield candidate", () => {
  it("is deterministic and strictly bounded for malformed counts", () => {
    expect(createStars()).toEqual(createStars());
    expect(createStars(100000)).toHaveLength(STAR_COUNT);
    expect(createStars(Infinity)).toHaveLength(0);
    expect(createStars(-1)).toHaveLength(0);
  });
  it("projects finite bounded particles after long pauses and wraparound", () => {
    const stars = createStars();
    for (let i = 0; i < 400; i++) advanceStars(stars, 99999);
    expect(stars.every(s => s.z >= .1 && s.z <= 2)).toBe(true);
    for (const star of stars) {
      const p = projectStar(star, 390, 844);
      expect([p.x, p.y, p.radius, p.opacity].every(Number.isFinite)).toBe(true);
      expect(p.radius).toBeLessThanOrEqual(2.1);
    }
  });
  it("draws one static frame under reduced motion and takes no WebGL context", () => {
    state.reduced = true;
    const { container } = render(<Starfield />);
    expect(container.querySelector("canvas")?.getAttribute("aria-hidden")).toBe("true");
    expect(draw.clearRect).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
    expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalledWith("2d", { alpha: true });
  });
  it("stops scheduling while hidden and cleans up after unmount", () => {
    const { unmount } = render(<Starfield />);
    expect(frames.size).toBe(1);
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(frames.size).toBe(0);
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(frames.size).toBe(1);
    unmount(); expect(frames.size).toBe(0);
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(frames.size).toBe(0);
  });
  it("switches full to reduced without leaving a running frame", () => {
    const { rerender } = render(<Starfield />);
    state.reduced = true; rerender(<Starfield />);
    expect(frames.size).toBe(0);
  });
  it("degrades quietly when Canvas2D is unavailable", () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    expect(() => render(<Starfield />)).not.toThrow();
    expect(frames.size).toBe(0);
  });
});
