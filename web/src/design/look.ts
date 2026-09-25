import { computeReduced, MOTION_EVENT } from "../lib/motionPref.js";

/**
 * Look and motion attributes on <html> (contract ui-remodel v1 §2).
 *
 * The server preference (GET /api/ui/preferences, Codex) is the authority once
 * it exists. This module only mirrors the last accepted look locally so the
 * first paint never flashes the wrong look; index.html runs the same logic
 * inline before the app loads.
 */

export type LookPref = "ink" | "paper" | "system";
export type Look = "ink" | "paper";

export const LOOK_KEY = "ava.ui.look";
export const LOOK_EVENT = "ava-look-change";
export const DEFAULT_LOOK: LookPref = "ink";

function osPrefersLight(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-color-scheme: light)").matches;
}

export function readLookPref(): LookPref {
  try {
    const value = localStorage.getItem(LOOK_KEY);
    if (value === "ink" || value === "paper" || value === "system") return value;
  } catch { /* storage blocked */ }
  return DEFAULT_LOOK;
}

/** "system" is an explicit choice only; nothing else consults the OS. */
export function resolveLook(pref: LookPref): Look {
  if (pref === "system") return osPrefersLight() ? "paper" : "ink";
  return pref;
}

/** Mirror a server-accepted look locally and apply it. */
export function mirrorLookPref(pref: LookPref): void {
  try { localStorage.setItem(LOOK_KEY, pref); } catch { /* storage blocked */ }
  applyLook();
  if (typeof window !== "undefined") window.dispatchEvent(new Event(LOOK_EVENT));
}

export function applyLook(root: HTMLElement = document.documentElement): Look {
  const look = resolveLook(readLookPref());
  root.dataset.look = look;
  return look;
}

export function applyMotion(root: HTMLElement = document.documentElement): "full" | "reduced" {
  const motion = computeReduced() ? "reduced" : "full";
  root.dataset.motion = motion;
  return motion;
}

/** Keep <html data-look data-motion> current. Returns a cleanup function. */
export function startDesignRuntime(): () => void {
  if (typeof window === "undefined") return () => {};
  applyLook();
  applyMotion();
  const onLook = () => applyLook();
  const onMotion = () => applyMotion();
  const colour = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: light)") : null;
  const reduce = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  colour?.addEventListener("change", onLook);
  reduce?.addEventListener("change", onMotion);
  window.addEventListener(MOTION_EVENT, onMotion);
  window.addEventListener("storage", onLook);
  return () => {
    colour?.removeEventListener("change", onLook);
    reduce?.removeEventListener("change", onMotion);
    window.removeEventListener(MOTION_EVENT, onMotion);
    window.removeEventListener("storage", onLook);
  };
}
