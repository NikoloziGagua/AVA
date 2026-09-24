// The decisions behind a chat bubble's entrance reveal, kept pure so the rule
// that guarantees Ava's replies end up visible is unit-tested without GSAP.
//
// The failure these guard against: reveal batches used to accumulate across
// re-renders, so a bubble that entered view later was revealed twice in one
// frame. The second tween overwrote the first and animated opacity 0 → 0,
// leaving the reply transparent.

export type Killable = { kill(): void };

/** Bubbles that no reveal has claimed yet. */
export const BUBBLE_REVEAL_SELECTOR = "[data-bubble]:not([data-entered])";
const ENTERED = "data-entered";

/**
 * Claims, at fire time, the bubbles that still need their entrance and marks
 * them. A bubble already claimed by another trigger (even in the same frame) is
 * never animated again.
 */
export function claimBubbles(els: Element[]): Element[] {
  const fresh = els.filter((el) => !el.hasAttribute(ENTERED));
  fresh.forEach((el) => el.setAttribute(ENTERED, ""));
  return fresh;
}

/** Start and end of the entrance. The end is explicit, so it can never be 0. */
export const REVEAL_FROM = { y: 18, opacity: 0, filter: "blur(6px)" } as const;
export const REVEAL_TO = {
  y: 0,
  opacity: 1,
  filter: "blur(0px)",
  clearProps: "transform,opacity,filter",
} as const;

/**
 * Replaces the reveal batch instead of accumulating it: the previous triggers
 * are always killed, and new ones are created only while reveals are enabled
 * (never under reduced motion).
 */
export function replaceRevealBatch(
  previous: Killable[],
  enabled: boolean,
  create: () => Killable[],
): Killable[] {
  previous.forEach((trigger) => trigger.kill());
  return enabled ? create() : [];
}
