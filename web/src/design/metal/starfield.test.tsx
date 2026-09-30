import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { advanceStars, createStars, projectStar, STAR_COUNT } from "./particles.js";
import { Starfield } from "./Starfield.js";
import { StrictMode } from "react";

const state = vi.hoisted(() => ({ reduced: false }));
vi.mock("../motion.js", () => ({ useReducedMotion: () => state.reduced }));
vi.mock("../face/useDocumentLook.js", () => ({ useDocumentLook: () => "ink" }));
const frames = new Map<number, FrameRequestCallback>();
let next = 0;
let intersect: IntersectionObserverCallback;
let forced: { matches: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };
const draw = { clearRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), setTransform: vi.fn(), globalAlpha: 1, fillStyle: "" };
beforeEach(() => {
  state.reduced = false; frames.clear(); next = 0;
  forced = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal("matchMedia", () => forced);
  vi.stubGlobal("CanvasRenderingContext2D", class {});
  Object.values(draw).forEach(v => { if (typeof v === "function") v.mockClear(); });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(draw as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 800, height: 600 } as DOMRect);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frames.set(++next, cb); return next; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("IntersectionObserver", class { constructor(cb: IntersectionObserverCallback) { intersect = cb; } observe() {} disconnect() {} });
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("production metal starfield", () => {
  it("caps phone count, DPR and large canvases", () => {
    vi.stubGlobal("devicePixelRatio", 4);
    vi.mocked(HTMLCanvasElement.prototype.getBoundingClientRect).mockReturnValue({ width: 390, height: 844 } as DOMRect);
    const { container, unmount } = render(<Starfield />);
    const phone = container.querySelector("canvas")!;
    expect(phone.dataset.starCount).toBe("500");
    expect(phone.width).toBe(585);
    unmount();
    vi.mocked(HTMLCanvasElement.prototype.getBoundingClientRect).mockReturnValue({ width: 8000, height: 8000 } as DOMRect);
    const desktop = render(<Starfield />).container.querySelector("canvas")!;
    expect(desktop.dataset.starCount).toBe("900");
    expect(desktop.width).toBe(3840);
    expect(desktop.height).toBe(2400);
  });
  it("keeps one loop in StrictMode, stops offscreen/forced colours and caps painting to 60fps", () => {
    const { unmount } = render(<StrictMode><Starfield /></StrictMode>);
    expect(frames.size).toBe(1);
    const run = (time: number) => { const [id, cb] = [...frames][0]!; frames.delete(id); act(() => cb(time)); };
    draw.clearRect.mockClear(); run(100); run(108); run(117); run(125); run(134);
    expect(draw.clearRect).toHaveBeenCalledTimes(3);
    act(() => intersect([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(frames.size).toBe(0);
    act(() => intersect([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(frames.size).toBe(1);
    forced.matches = true; draw.arc.mockClear();
    act(() => forced.addEventListener.mock.calls.at(-1)![1]());
    expect(frames.size).toBe(0);
    expect(draw.arc).not.toHaveBeenCalled();
    unmount(); expect(forced.removeEventListener).toHaveBeenCalled();
  });
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
