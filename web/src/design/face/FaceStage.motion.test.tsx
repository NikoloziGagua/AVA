import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseFaceAsset } from "./asset.js";
import { buildFaceAsset } from "./fixture.test-helper.js";
import { setMotionPref } from "../../lib/motionPref.js";

type Drawn = { pointer: unknown; still: boolean; profile: string; breath: number };
const fake = vi.hoisted(() => ({ draws: 0, pointers: [] as unknown[], frames: [] as Drawn[], presence: [] as number[], instances: [] as Array<{ released: number }>, resized: [] as Array<() => void> }));
vi.mock("./asset.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./asset.js")>()),
  sharedFaceAsset: vi.fn(),
}));
vi.mock("./renderer.js", () => ({
  FaceRenderer: class {
    setPoints() {}
    setPresence(value: number) { fake.presence.push(value); }
    released = 0;
    constructor() { fake.instances.push(this); }
    release() { this.released += 1; }
    resize() {}
    draw(_t: number, anim: { pointer: unknown; still: boolean; profile: string; state: { breath: number } }) {
      fake.draws += 1;
      fake.pointers.push(anim.pointer);
      fake.frames.push({ pointer: anim.pointer, still: anim.still, profile: anim.profile, breath: anim.state.breath });
    }
    dispose() {}
  },
}));

import * as asset from "./asset.js";
import { FACE_PRESENCE, FaceStage } from "./FaceStage.js";

beforeEach(() => {
  fake.draws = 0;
  fake.pointers = [];
  fake.frames = [];
  fake.presence = [];
  fake.instances = [];
  fake.resized = [];
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { fake.resized.push(callback); } observe() {} disconnect() {} });
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
  vi.mocked(asset.sharedFaceAsset).mockResolvedValue(parseFaceAsset(buildFaceAsset()));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

describe("FaceStage under reduced motion", () => {
  it("draws one static frame and never takes in the pointer", async () => {
    localStorage.setItem("ava-motion", "reduced");
    const { container } = render(<FaceStage label="AVA" />);
    await waitFor(() => expect(fake.draws).toBeGreaterThan(0));
    const before = fake.draws;
    const canvas = container.querySelector("canvas")!;
    fireEvent.pointerMove(canvas, { clientX: 10, clientY: 10 });
    fireEvent.pointerLeave(canvas);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fake.draws).toBe(before);
    // A later redraw (a resize) must still show the face looking straight ahead.
    fireEvent.pointerMove(canvas, { clientX: 10, clientY: 10 });
    fake.resized.forEach((callback) => callback());
    expect(fake.draws).toBeGreaterThan(before);
    expect(fake.pointers.every((pointer) => pointer === null)).toBe(true);
  });
});

describe("FaceStage lively profile (Niko's room messages 773 and 775)", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 4) as unknown as number);
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  });

  it("uses the approved lively profile at a slightly more solid presence", async () => {
    localStorage.setItem("ava-motion", "full");
    render(<FaceStage label="AVA" />);
    await waitFor(() => expect(fake.draws).toBeGreaterThan(3));
    expect(FACE_PRESENCE).toBe(1.12);
    expect(fake.presence).toEqual([1.12]);
    expect(fake.frames.every((frame) => frame.profile === "lively" && frame.still === false)).toBe(true);
  });

  it("goes exactly still under reduced motion and comes back alive, clearing pointer tracking each time", async () => {
    localStorage.setItem("ava-motion", "full");
    const { container } = render(<FaceStage label="AVA" />);
    await waitFor(() => expect(fake.draws).toBeGreaterThan(2));
    const canvas = container.querySelector("canvas")!;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
    fireEvent.pointerMove(canvas, { clientX: 90, clientY: 10 });
    await waitFor(() => expect(fake.frames.at(-1)?.pointer).not.toBeNull());

    act(() => setMotionPref("reduced"));
    await waitFor(() => expect(fake.frames.at(-1)?.still).toBe(true));
    const reducedAt = fake.frames.length;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(fake.frames.length).toBe(reducedAt);
    expect(fake.frames.at(-1)).toMatchObject({ still: true, pointer: null, breath: 0 });
    fireEvent.pointerMove(canvas, { clientX: 90, clientY: 10 });
    fake.resized.at(-1)?.();
    expect(fake.frames.at(-1)).toMatchObject({ still: true, pointer: null, breath: 0 });

    act(() => setMotionPref("full"));
    await waitFor(() => expect(fake.frames.length).toBeGreaterThan(reducedAt + 3));
    const resumed = fake.frames.slice(reducedAt + 1);
    expect(resumed.every((frame) => frame.still === false && frame.profile === "lively")).toBe(true);
    expect(resumed[0]!.pointer).toBeNull();
  });
});

describe("FaceStage context release", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 4) as unknown as number);
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  });

  it("keeps the context through StrictMode and motion changes, and gives it back once on a real unmount", async () => {
    localStorage.setItem("ava-motion", "full");
    const { unmount } = render(<StrictMode><FaceStage label="AVA" /></StrictMode>);
    await waitFor(() => expect(fake.draws).toBeGreaterThan(2));
    act(() => setMotionPref("reduced"));
    await waitFor(() => expect(fake.frames.at(-1)?.still).toBe(true));
    act(() => setMotionPref("full"));
    await waitFor(() => expect(fake.frames.at(-1)?.still).toBe(false));
    await new Promise((resolve) => setTimeout(resolve, 20));
    // Only renderers made in this test are counted; an earlier test's release may land late.
    expect(fake.instances.length).toBeGreaterThan(1);
    expect(fake.instances.every((instance) => instance.released === 0)).toBe(true);
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fake.instances.map((instance) => instance.released).sort()).toEqual([...Array(fake.instances.length - 1).fill(0), 1]);
  });
});
