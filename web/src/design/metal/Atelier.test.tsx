import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LightTrace } from "./LightTrace.js";
import { MetalObject } from "./MetalObject.js";
import { Atmosphere } from "./Atmosphere.js";

const state = vi.hoisted(() => ({ reduced: false }));
vi.mock("../motion.js", () => ({ useReducedMotion: () => state.reduced }));
vi.mock("../face/useDocumentLook.js", () => ({ useDocumentLook: () => "ink" }));
const frames = new Map<number, FrameRequestCallback>();
const draw = { clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), setTransform: vi.fn() };
let next = 0;
let intersect: IntersectionObserverCallback;
let forced: { matches: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };
beforeEach(() => {
  state.reduced = false; frames.clear(); next = 0;
  Object.values(draw).forEach((fn) => { if (vi.isMockFunction(fn)) fn.mockClear(); });
  forced = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal("matchMedia", () => forced);
  vi.stubGlobal("CanvasRenderingContext2D", class {});
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(draw as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 390, height: 844 } as DOMRect);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frames.set(++next, cb); return next; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("IntersectionObserver", class { constructor(cb: IntersectionObserverCallback) { intersect = cb; } observe() {} disconnect() {} });
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Atelier production objects", () => {
  it.each(["cut", "time", "twin"] as const)("%s exposes only supplied information and one real action", (variant) => {
    const open = vi.fn();
    const { container } = render(<MetalObject variant={variant} title="My real note" eyebrow="Pinned" detail="Open note" onClick={open} />);
    fireEvent.click(screen.getByRole("button", { name: /My real note/ }));
    expect(open).toHaveBeenCalledOnce();
    expect(container.querySelectorAll("button")).toHaveLength(1);
    expect(container.textContent).not.toMatch(/60 min|verified|progress|03/);
  });
  it("read-only cards have no invented interaction or unsafe content", () => {
    const { container } = render(<MetalObject variant="cut" title="<script>alert(1)</script>" eyebrow="Reminder" />);
    expect(container.querySelector("button,script,a")).toBeNull();
    expect(screen.getByText("<script>alert(1)</script>")).toBeTruthy();
  });
});

describe("Light trace", () => {
  const items = [{ id: "home", label: "Home" }, { id: "talk", label: "Talk" }, { id: "notes", label: "Notes" }];
  it("follows route changes, never navigates on focus, and supports arrow/edge keys", () => {
    const navigate = vi.fn();
    const { rerender, container } = render(<LightTrace items={items} current="home" onNavigate={navigate} />);
    const home = screen.getByRole("button", { name: "Home" });
    home.focus(); fireEvent.keyDown(home, { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Talk" }));
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Notes" }));
    fireEvent.click(document.activeElement!);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("notes");
    rerender(<LightTrace items={items} current="notes" onNavigate={navigate} />);
    expect(screen.getByRole("button", { name: "Notes" }).getAttribute("aria-current")).toBe("page");
    expect((container.firstChild as HTMLElement).style.getPropertyValue("--trace-index")).toBe("2");
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toBe(home);
  });
  it("does not falsely mark a primary destination for a system screen", () => {
    const { container } = render(<LightTrace items={items} current="settings" onNavigate={vi.fn()} />);
    expect(container.querySelector("[aria-current]")).toBeNull();
    expect(container.querySelector<HTMLElement>(".ds-light-trace-mark")?.hidden).toBe(true);
  });
});

describe("production atmospheres", () => {
  it("can hold the Nocturne ground still behind stars even in Full motion", () => {
    const { container } = render(<Atmosphere kind="nocturne" still />);
    expect(container.querySelector("canvas")?.getAttribute("data-motion")).toBe("static");
    expect(draw.stroke).toHaveBeenCalledTimes(36);
    expect(frames.size).toBe(0);
  });
  it.each(["nocturne", "silk"] as const)("%s draws bounded lines; takes only a 2D context", (kind) => {
    const { container } = render(<Atmosphere kind={kind} />);
    expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalledWith("2d");
    expect(draw.stroke).toHaveBeenCalledTimes(36);
    expect(draw.lineTo).toHaveBeenCalledTimes(36 * 48);
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
    expect(frames.size).toBe(1);
  });
  it("has one loop under StrictMode, pauses hidden/offscreen, and cleans up", () => {
    const { unmount } = render(<StrictMode><Atmosphere kind="silk" /></StrictMode>);
    expect(frames.size).toBe(1);
    act(() => intersect([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(frames.size).toBe(0);
    act(() => intersect([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(frames.size).toBe(1);
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(frames.size).toBe(0);
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(frames.size).toBe(1);
    unmount(); expect(frames.size).toBe(0);
    expect(forced.removeEventListener).toHaveBeenCalled();
  });
  it("switches to static on reduced motion, and omits artwork in forced colours", () => {
    const { rerender } = render(<Atmosphere kind="nocturne" />);
    state.reduced = true; rerender(<Atmosphere kind="nocturne" />);
    expect(frames.size).toBe(0);
    cleanup(); draw.stroke.mockClear(); forced.matches = true; state.reduced = false;
    render(<Atmosphere kind="silk" />);
    expect(frames.size).toBe(0);
    expect(draw.stroke).not.toHaveBeenCalled();
  });
  it("caps DPR and dimensions and contains unavailable canvas", () => {
    vi.stubGlobal("devicePixelRatio", 4);
    vi.mocked(HTMLCanvasElement.prototype.getBoundingClientRect).mockReturnValue({ width: 9000, height: 9000 } as DOMRect);
    const { container, unmount } = render(<Atmosphere kind="silk" />);
    expect(container.querySelector("canvas")?.width).toBe(3840);
    expect(container.querySelector("canvas")?.height).toBe(2400);
    unmount();
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(() => { throw new Error("unavailable"); });
    expect(() => render(<Atmosphere kind="nocturne" />)).not.toThrow();
    expect(frames.size).toBe(0);
  });
});
