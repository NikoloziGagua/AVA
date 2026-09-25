import { flushSync } from "react-dom";
import { computeReduced } from "../lib/motionPref.js";

export { useReducedMotion } from "../lib/useReducedMotion.js";

/** The one spring vocabulary (contract ui-remodel v1 §2). Use with Motion's `transition` prop. */
export const springs = {
  snappy: { type: "spring", stiffness: 420, damping: 34 },
  gentle: { type: "spring", stiffness: 170, damping: 26 },
  /** Menus and the bottom bar only. */
  bouncy: { type: "spring", stiffness: 300, damping: 18 },
} as const;

export const durations = { fast: 0.15, base: 0.24, slow: 0.4, screen: 0.38 } as const;
export const easeOutSoft = [0.22, 1, 0.36, 1] as const;

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};

/**
 * Run a navigation state update inside a View Transition when the browser
 * supports it and motion is not reduced. Otherwise swap instantly.
 * The update is flushed synchronously so the new DOM is captured.
 */
export function withViewTransition(update: () => void): void {
  const doc = typeof document === "undefined" ? null : (document as ViewTransitionDocument);
  if (!doc?.startViewTransition || computeReduced()) {
    update();
    return;
  }
  try {
    doc.startViewTransition(() => { flushSync(update); });
  } catch {
    update();
  }
}
