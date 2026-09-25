import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyLook, applyMotion, LOOK_EVENT, LOOK_KEY, mirrorLookPref, readLookPref, resolveLook, startDesignRuntime } from "./look.js";
import { withViewTransition } from "./motion.js";

function mockMatchMedia(matches: Record<string, boolean>) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: matches[query] ?? false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.look;
  delete document.documentElement.dataset.motion;
  mockMatchMedia({});
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("look", () => {
  it("defaults to Ink when nothing is stored", () => {
    expect(readLookPref()).toBe("ink");
    expect(applyLook()).toBe("ink");
    expect(document.documentElement.dataset.look).toBe("ink");
  });

  it("ignores unknown stored values", () => {
    localStorage.setItem(LOOK_KEY, "neon");
    expect(readLookPref()).toBe("ink");
  });

  it("uses Paper when chosen", () => {
    localStorage.setItem(LOOK_KEY, "paper");
    expect(applyLook()).toBe("paper");
  });

  it("follows the OS only when system is explicitly chosen", () => {
    mockMatchMedia({ "(prefers-color-scheme: light)": true });
    expect(resolveLook("ink")).toBe("ink");
    expect(resolveLook("system")).toBe("paper");
    mockMatchMedia({ "(prefers-color-scheme: light)": false });
    expect(resolveLook("system")).toBe("ink");
  });

  it("mirrors an accepted preference, applies it and announces it", () => {
    const heard = vi.fn();
    window.addEventListener(LOOK_EVENT, heard);
    mirrorLookPref("paper");
    expect(localStorage.getItem(LOOK_KEY)).toBe("paper");
    expect(document.documentElement.dataset.look).toBe("paper");
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener(LOOK_EVENT, heard);
  });

  it("still applies the default when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(applyLook()).toBe("ink");
  });
});

describe("motion attribute", () => {
  it("is full by default, even when the OS asks to reduce (Niko's explicit default)", () => {
    mockMatchMedia({ "(prefers-reduced-motion: reduce)": true });
    expect(applyMotion()).toBe("full");
  });

  it("is reduced when the in-app preference says so", () => {
    localStorage.setItem("ava-motion", "reduced");
    expect(applyMotion()).toBe("reduced");
  });

  it("follows the OS when the preference is system", () => {
    localStorage.setItem("ava-motion", "system");
    mockMatchMedia({ "(prefers-reduced-motion: reduce)": true });
    expect(applyMotion()).toBe("reduced");
  });

  it("runtime sets both attributes and cleans up its listeners", () => {
    const stop = startDesignRuntime();
    expect(document.documentElement.dataset.look).toBe("ink");
    expect(document.documentElement.dataset.motion).toBe("full");
    stop();
  });
});

describe("withViewTransition", () => {
  afterEach(() => { delete (document as { startViewTransition?: unknown }).startViewTransition; });

  it("swaps instantly when the browser has no View Transitions", () => {
    const update = vi.fn();
    withViewTransition(update);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("runs the update inside a view transition when supported", () => {
    const start = vi.fn((cb: () => void) => { cb(); return { finished: Promise.resolve() }; });
    Object.assign(document, { startViewTransition: start });
    const update = vi.fn();
    withViewTransition(update);
    expect(start).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("skips the transition when motion is reduced", () => {
    localStorage.setItem("ava-motion", "reduced");
    const start = vi.fn();
    Object.assign(document, { startViewTransition: start });
    const update = vi.fn();
    withViewTransition(update);
    expect(start).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("falls back to an instant swap if the transition throws", () => {
    Object.assign(document, { startViewTransition: () => { throw new Error("invalid state"); } });
    const update = vi.fn();
    withViewTransition(update);
    expect(update).toHaveBeenCalledTimes(1);
  });
});
