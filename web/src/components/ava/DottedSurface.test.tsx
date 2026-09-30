// @vitest-environment jsdom
// The WebGL loop runs in animation frames and resize events, outside any React
// error boundary. A failure there must stop the loop, release everything once
// and report once, so voice can fall back to its static backdrop.
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const gl = vi.hoisted(() => ({
  renders: 0,
  failOnRender: 0,
  failSetSize: false,
  disposeThrows: false,
  disposals: { geometry: 0, material: 0, renderer: 0 },
}));
const motion = vi.hoisted(() => ({ reduced: false }));

vi.mock("three", () => {
  class Float32BufferAttribute {
    array: Float32Array;
    needsUpdate = false;
    constructor(values: number[]) { this.array = new Float32Array(values); }
  }
  return {
    Scene: class { add() {} },
    PerspectiveCamera: class { aspect = 1; position = { set() {} }; updateProjectionMatrix() {} },
    WebGLRenderer: class {
      domElement = document.createElement("canvas");
      setPixelRatio() {}
      setClearColor() {}
      setSize() { if (gl.failSetSize) throw new Error("context lost on resize"); }
      render() {
        gl.renders += 1;
        if (gl.renders === gl.failOnRender) throw new Error("context lost");
      }
      dispose() {
        gl.disposals.renderer += 1;
        if (gl.disposeThrows) throw new Error("dispose failed");
      }
    },
    BufferGeometry: class {
      attributes: Record<string, unknown> = {};
      setAttribute(name: string, value: unknown) { this.attributes[name] = value; }
      dispose() { gl.disposals.geometry += 1; }
    },
    Float32BufferAttribute,
    PointsMaterial: class { dispose() { gl.disposals.material += 1; } },
    Points: class {},
  };
});
vi.mock("../../lib/useReducedMotion.js", () => ({ useReducedMotion: () => motion.reduced }));
vi.mock("../../lib/deckMotion.js", () => ({ glPaused: () => false }));

import { DottedSurface } from "./DottedSurface.js";

let frames: Array<FrameRequestCallback | null> = [];
const pendingFrames = () => frames.filter(Boolean).length;
function runFrame() {
  const index = frames.findIndex(Boolean);
  if (index < 0) throw new Error("no frame is scheduled");
  const callback = frames[index]!;
  frames[index] = null;
  act(() => callback(performance.now()));
}

beforeEach(() => {
  frames = [];
  Object.assign(gl, { renders: 0, failOnRender: 0, failSetSize: false, disposeThrows: false });
  gl.disposals = { geometry: 0, material: 0, renderer: 0 };
  motion.reduced = false;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => { frames[id - 1] = null; });
  Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DottedSurface failure containment", () => {
  it("animates frame after frame and releases everything once on unmount", () => {
    const onError = vi.fn();
    const view = render(<DottedSurface onError={onError} />);
    runFrame();
    runFrame();
    runFrame();
    expect(gl.renders).toBe(3);
    expect(pendingFrames()).toBe(1);
    view.unmount();
    expect(pendingFrames()).toBe(0);
    expect(gl.disposals).toEqual({ geometry: 1, material: 1, renderer: 1 });
    expect(onError).not.toHaveBeenCalled();
  });

  it("stops the loop, cleans up and reports once when a later frame fails", () => {
    gl.failOnRender = 3;
    const onError = vi.fn();
    const view = render(<DottedSurface onError={onError} />);
    runFrame();
    runFrame();
    runFrame();
    expect(onError).toHaveBeenCalledOnce();
    expect((onError.mock.calls[0]![0] as Error).message).toBe("context lost");
    expect(pendingFrames()).toBe(0);
    expect(gl.disposals).toEqual({ geometry: 1, material: 1, renderer: 1 });
    expect(view.container.querySelector("canvas")).toBeNull();
    view.unmount();
    expect(gl.disposals).toEqual({ geometry: 1, material: 1, renderer: 1 });
    expect(onError).toHaveBeenCalledOnce();
  });

  it("stops and reports once when a resize fails, and ignores later resizes", () => {
    const onError = vi.fn();
    render(<DottedSurface onError={onError} />);
    runFrame();
    gl.failSetSize = true;
    act(() => { window.dispatchEvent(new Event("resize")); });
    act(() => { window.dispatchEvent(new Event("resize")); });
    expect(onError).toHaveBeenCalledOnce();
    expect((onError.mock.calls[0]![0] as Error).message).toBe("context lost on resize");
    expect(pendingFrames()).toBe(0);
    expect(gl.disposals).toEqual({ geometry: 1, material: 1, renderer: 1 });
  });

  it("reports a failed reduced-motion render without ever scheduling frames", () => {
    motion.reduced = true;
    gl.failOnRender = 1;
    const onError = vi.fn();
    render(<DottedSurface onError={onError} />);
    expect(onError).toHaveBeenCalledOnce();
    expect(frames).toHaveLength(0);
    expect(gl.disposals).toEqual({ geometry: 1, material: 1, renderer: 1 });
  });

  it("keeps releasing the rest when one disposal throws", () => {
    gl.failOnRender = 1;
    gl.disposeThrows = true;
    const onError = vi.fn();
    const view = render(<DottedSurface onError={onError} />);
    expect(() => runFrame()).not.toThrow();
    expect(onError).toHaveBeenCalledOnce();
    expect(gl.disposals).toEqual({ geometry: 1, material: 1, renderer: 1 });
    expect(view.container.querySelector("canvas")).toBeNull();
    expect(() => view.unmount()).not.toThrow();
    expect(gl.disposals.renderer).toBe(1);
  });
});
