import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseFaceAsset } from "./asset.js";
import { buildFaceAsset } from "./fixture.test-helper.js";

const assetState = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("./asset.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./asset.js")>()),
  sharedFaceAsset: assetState.load,
}));

import { FaceAnimator } from "./animator.js";
import { buildPoints, FLOATS } from "./model.js";
import { claimFaceSlot, FaceStage } from "./FaceStage.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("FaceStage", () => {
  it("falls back to the still face when WebGL is unavailable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    assetState.load.mockResolvedValue(parseFaceAsset(buildFaceAsset()));
    const { container } = render(<FaceStage label="AVA" />);
    await waitFor(() => expect(container.querySelector('[data-face="still"]')).not.toBeNull());
    expect(screen.getByRole("img", { name: "AVA" })).toBeTruthy();
  });

  it("falls back when the face asset cannot be loaded", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    assetState.load.mockRejectedValue(new Error("missing"));
    const { container } = render(<FaceStage label="AVA" />);
    await waitFor(() => expect(container.querySelector('[data-face="still"]')).not.toBeNull());
  });

  it("allows only one animated face at a time", () => {
    const first = claimFaceSlot();
    expect(first).not.toBeNull();
    expect(claimFaceSlot()).toBeNull();
    first!();
    const again = claimFaceSlot();
    expect(again).not.toBeNull();
    again!();
  });
});

describe("face model", () => {
  it("builds one record per dot, capped at the limit, with finite values", () => {
    const asset = parseFaceAsset(buildFaceAsset({ stipple: 300, glow: 200 }));
    const built = buildPoints(asset, "stipple", 120);
    expect(built.count).toBe(120);
    expect(built.data.length).toBe(120 * FLOATS);
    expect([...built.data].every(Number.isFinite)).toBe(true);
    expect(buildPoints(asset, "glow", 10_000).count).toBe(200);
  });
});

describe("FaceAnimator", () => {
  it("blinks on request and settles back open", () => {
    const anim = new FaceAnimator(() => 0.5);
    anim.trigger("blink", 10);
    anim.step(10.07, 0.016);
    expect(anim.state.blink).toBeGreaterThan(0.9);
    anim.step(10.5, 0.016);
    expect(anim.state.blink).toBe(0);
  });

  it("opens the jaw with live voice energy while speaking, and closes it otherwise", () => {
    const anim = new FaceAnimator(() => 0.5);
    anim.mode = "speaking";
    anim.level = 1;
    for (let i = 0; i < 60; i++) anim.step(1 + i / 60, 1 / 60);
    expect(anim.state.open).toBeGreaterThan(0.5);
    anim.mode = "idle";
    for (let i = 0; i < 120; i++) anim.step(2 + i / 60, 1 / 60);
    expect(Math.abs(anim.state.open)).toBeLessThan(0.05);
  });

  it("turns toward the pointer", () => {
    const anim = new FaceAnimator(() => 0.5);
    anim.pointer = [1, 0];
    for (let i = 0; i < 240; i++) anim.step(i / 60, 1 / 60);
    expect(anim.state.yaw).toBeGreaterThan(0.1);
    expect(anim.state.gx).toBeGreaterThan(0.5);
  });
});
