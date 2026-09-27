import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseFaceAsset } from "./asset.js";
import { buildFaceAsset } from "./fixture.test-helper.js";

const fake = vi.hoisted(() => ({ levels: [] as Array<number | null> }));
vi.mock("./asset.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./asset.js")>()),
  sharedFaceAsset: vi.fn(),
}));
vi.mock("./renderer.js", () => ({
  FaceRenderer: class {
    setPoints() {}
    setPresence() {}
    resize() {}
    draw(_t: number, anim: { level: number | null }) { fake.levels.push(anim.level); }
    dispose() {}
  },
}));

import * as asset from "./asset.js";
import { FaceStage } from "./FaceStage.js";

beforeEach(() => {
  fake.levels = [];
  localStorage.setItem("ava-motion", "full");
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 4) as unknown as number);
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  vi.mocked(asset.sharedFaceAsset).mockResolvedValue(parseFaceAsset(buildFaceAsset()));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

describe("FaceStage live level", () => {
  it("reads the level every frame from the sampler, clamped, without re-rendering", async () => {
    const values: Array<number | (() => never)> = [0.4, 2, Number.NaN, () => { throw new Error("gone"); }, 0.1];
    let at = 0;
    const sampleLevel = vi.fn(() => {
      const next = values[Math.min(at++, values.length - 1)]!;
      return typeof next === "function" ? next() : next;
    });
    render(<FaceStage mode="speaking" sampleLevel={sampleLevel} />);
    await waitFor(() => expect(fake.levels.length).toBeGreaterThanOrEqual(5));
    expect(fake.levels.slice(0, 5)).toEqual([0.4, 1, null, null, 0.1]);
    expect(sampleLevel.mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it("keeps using the level prop when no sampler is given", async () => {
    render(<FaceStage mode="speaking" level={0.3} />);
    await waitFor(() => expect(fake.levels.length).toBeGreaterThan(0));
    expect(fake.levels.every((level) => level === 0.3)).toBe(true);
  });
});
