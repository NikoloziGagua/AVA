// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const state = vi.hoisted(() => ({ reduced: true, moduleLoads: 0, mounts: 0 }));

vi.mock("../lib/useReducedMotion.js", () => ({
  useReducedMotion: () => state.reduced,
}));

vi.mock("../components/ava/DottedSurface.js", async () => {
  state.moduleLoads += 1;
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    DottedSurface: () => {
      React.useEffect(() => {
        state.mounts += 1;
      }, []);
      return <div data-testid="dotted-webgl-surface" />;
    },
  };
});

import {
  HomeSurface,
  HomeSurfaceBoundary,
  supportsHomeWebGL,
} from "./HomeSurface.js";

const originalGetContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "getContext");

function installWebGLProbe(supported: boolean) {
  const loseContext = vi.fn();
  const getContext = vi.fn(() => supported ? {
    getExtension: (name: string) => name === "WEBGL_lose_context" ? { loseContext } : null,
  } : null);
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: getContext,
  });
  return { getContext, loseContext };
}

function BrokenSurface(): never {
  throw new Error("renderer failed");
}

describe.sequential("HomeSurface demand loading", () => {
  beforeEach(() => {
    state.reduced = true;
    state.mounts = 0;
  });

  afterEach(() => {
    cleanup();
    if (originalGetContext) {
      Object.defineProperty(HTMLCanvasElement.prototype, "getContext", originalGetContext);
    }
    vi.restoreAllMocks();
  });

  it("keeps the WebGL module unloaded for the initial/reduced-motion path", () => {
    const probe = installWebGLProbe(true);
    render(<HomeSurface />);

    expect(screen.queryByTestId("dotted-webgl-surface")).toBeNull();
    expect(document.querySelector('[data-home-surface="static"]')).toBeTruthy();
    expect(probe.getContext).not.toHaveBeenCalled();
    expect(state.moduleLoads).toBe(0);
  });

  it("uses the same static fallback when a WebGL context is unavailable", () => {
    state.reduced = false;
    const probe = installWebGLProbe(false);
    expect(supportsHomeWebGL()).toBe(false);
    render(<HomeSurface />);

    expect(document.querySelector('[data-home-surface="static"]')).toBeTruthy();
    expect(probe.getContext).toHaveBeenCalled();
    expect(state.moduleLoads).toBe(0);
  });

  it("contains a renderer failure without removing Home content", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(
      <div>
        <button type="button">Home command</button>
        <HomeSurfaceBoundary><BrokenSurface /></HomeSurfaceBoundary>
      </div>,
    );

    expect(screen.getByRole("button", { name: "Home command" })).toBeTruthy();
    expect(document.querySelector('[data-home-surface="static"]')).toBeTruthy();
    expect(consoleWarn).toHaveBeenCalledOnce();
    consoleError.mockRestore();
    consoleWarn.mockRestore();
  });

  it("loads and mounts WebGL once when the full-motion Home path first renders", async () => {
    state.reduced = false;
    const probe = installWebGLProbe(true);
    const view = render(<HomeSurface />);

    expect(document.querySelector('[data-home-surface="static"]')).toBeTruthy();
    expect(await screen.findByTestId("dotted-webgl-surface")).toBeTruthy();
    expect(state.moduleLoads).toBe(1);
    expect(state.mounts).toBe(1);
    expect(probe.loseContext).toHaveBeenCalledOnce();

    view.rerender(<HomeSurface />);
    await waitFor(() => expect(state.mounts).toBe(1));
  });
});
