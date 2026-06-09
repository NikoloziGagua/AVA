// In-app motion preference, so the OS "reduce motion" setting can't silently kill
// every animation. Ava's owner explicitly wants the motion, so the DEFAULT is
// "full" (animate regardless of the OS). "system" defers to the OS media query;
// "reduced" forces everything static. Changed via the Rules screen toggle.

export type MotionPref = "full" | "system" | "reduced";

const KEY = "ava-motion";
/** Fired on any change so every useReducedMotion() consumer re-evaluates. */
export const MOTION_EVENT = "ava-motion-change";

export function getMotionPref(): MotionPref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "system" || v === "reduced") return v;
  } catch { /* SSR / blocked storage */ }
  return "full";
}

export function setMotionPref(pref: MotionPref): void {
  try { localStorage.setItem(KEY, pref); } catch { /* */ }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(MOTION_EVENT));
}

/** The effective "reduce motion?" boolean: full→false, reduced→true, system→OS. */
export function computeReduced(): boolean {
  const pref = getMotionPref();
  if (pref === "full") return false;
  if (pref === "reduced") return true;
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
