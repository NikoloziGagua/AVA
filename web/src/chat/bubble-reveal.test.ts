// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import {
  BUBBLE_REVEAL_SELECTOR,
  claimBubbles,
  REVEAL_FROM,
  REVEAL_TO,
  replaceRevealBatch,
} from "./bubble-reveal.js";

function bubble(): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-bubble", "");
  document.body.appendChild(el);
  return el;
}

describe("chat bubble reveal", () => {
  it("never re-animates a bubble another trigger already revealed in the same frame", () => {
    const reply = bubble();
    const animate = vi.fn();
    // Two batches that both selected the bubble before either fired.
    const onEnter = (els: Element[]) => {
      const fresh = claimBubbles(els);
      if (fresh.length) animate(fresh);
    };
    onEnter([reply]);
    onEnter([reply]);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate).toHaveBeenCalledWith([reply]);
    expect(reply.matches(BUBBLE_REVEAL_SELECTOR)).toBe(false);
  });

  it("claims only unrevealed bubbles from a mixed batch", () => {
    const seen = bubble();
    const fresh = bubble();
    claimBubbles([seen]);
    expect(claimBubbles([seen, fresh])).toEqual([fresh]);
  });

  it("always ends the entrance fully visible and hands opacity back to CSS", () => {
    expect(REVEAL_FROM.opacity).toBe(0);
    expect(REVEAL_TO.opacity).toBe(1);
    expect(REVEAL_TO.clearProps.split(",")).toContain("opacity");
  });

  it("replaces the previous batch instead of accumulating it", () => {
    const first = [{ kill: vi.fn() }, { kill: vi.fn() }];
    const next = [{ kill: vi.fn() }];
    const create = vi.fn(() => next);
    expect(replaceRevealBatch(first, true, create)).toBe(next);
    for (const trigger of first) expect(trigger.kill).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
  });

  it("creates no batch under reduced motion and still retires the old one", () => {
    const old = [{ kill: vi.fn() }];
    const create = vi.fn(() => [{ kill: vi.fn() }]);
    expect(replaceRevealBatch(old, false, create)).toEqual([]);
    expect(old[0]!.kill).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
  });
});
