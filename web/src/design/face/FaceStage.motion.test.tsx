import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseFaceAsset } from "./asset.js";
import { buildFaceAsset } from "./fixture.test-helper.js";

const fake = vi.hoisted(() => ({ draws: 0, pointers: [] as unknown[], resized: [] as Array<() => void> }));
vi.mock("./asset.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./asset.js")>()),
  sharedFaceAsset: vi.fn(),
}));
vi.mock("./renderer.js", () => ({
  FaceRenderer: class {
    setPoints() {}
    resize() {}
    draw(_t: number, anim: { pointer: unknown }) { fake.draws += 1; fake.pointers.push(anim.pointer); }
    dispose() {}
  },
}));

import * as asset from "./asset.js";
import { FaceStage } from "./FaceStage.js";

beforeEach(() => {
  fake.draws = 0;
  fake.pointers = [];
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
