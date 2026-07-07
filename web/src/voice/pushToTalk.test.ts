import { describe, it, expect } from "vitest";
import { shouldStartHold, shouldFinishHold, isTypingTarget } from "./pushToTalk.js";

function ev(over: Partial<{ key: string; code: string; repeat: boolean; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean; target: unknown }> = {}) {
  return { key: " ", repeat: false, target: null, ...over } as Parameters<typeof shouldStartHold>[0];
}

describe("shouldStartHold — press-and-hold Space starts a turn", () => {
  it("starts on a bare Space keydown in push-to-talk mode", () => {
    expect(shouldStartHold(ev(), "enter_push_to_talk")).toBe(true);
    expect(shouldStartHold(ev({ key: "", code: "Space" }), "enter_push_to_talk")).toBe(true);
  });

  it("does nothing in VAD mode", () => {
    expect(shouldStartHold(ev(), "vad")).toBe(false);
  });

  it("ignores key-repeat (the OS fires repeated keydowns while Space is held)", () => {
    // Exactly ONE start per physical press — the hold is held down, not re-toggled.
    expect(shouldStartHold(ev({ repeat: true }), "enter_push_to_talk")).toBe(false);
  });

  it("ignores non-Space keys — Enter is no longer bound (no double-dispatch)", () => {
    expect(shouldStartHold(ev({ key: "Enter", code: "Enter" }), "enter_push_to_talk")).toBe(false);
    expect(shouldStartHold(ev({ key: "a", code: "KeyA" }), "enter_push_to_talk")).toBe(false);
  });

  it("ignores modifier+Space so it doesn't collide with other shortcuts", () => {
    expect(shouldStartHold(ev({ shiftKey: true }), "enter_push_to_talk")).toBe(false);
    expect(shouldStartHold(ev({ metaKey: true }), "enter_push_to_talk")).toBe(false);
    expect(shouldStartHold(ev({ ctrlKey: true }), "enter_push_to_talk")).toBe(false);
  });

  it("does not fire while typing in an input/textarea/contenteditable", () => {
    expect(shouldStartHold(ev({ target: { tagName: "INPUT" } }), "enter_push_to_talk")).toBe(false);
    expect(shouldStartHold(ev({ target: { tagName: "TEXTAREA" } }), "enter_push_to_talk")).toBe(false);
    expect(shouldStartHold(ev({ target: { tagName: "DIV", isContentEditable: true } }), "enter_push_to_talk")).toBe(false);
  });

  it("still starts on a non-text element like a button or the body", () => {
    // Space is preventDefault'd by the caller so a focused button doesn't ALSO
    // activate — the voice screen treats Space as 'talk' everywhere but text fields.
    expect(shouldStartHold(ev({ target: { tagName: "BODY" } }), "enter_push_to_talk")).toBe(true);
    expect(shouldStartHold(ev({ target: { tagName: "BUTTON" } }), "enter_push_to_talk")).toBe(true);
  });
});

describe("shouldFinishHold — releasing Space commits the turn", () => {
  it("finishes on a Space keyup in push-to-talk mode", () => {
    expect(shouldFinishHold(ev(), "enter_push_to_talk")).toBe(true);
    expect(shouldFinishHold(ev({ key: "", code: "Space" }), "enter_push_to_talk")).toBe(true);
  });

  it("is lenient — a Space release commits even with a stale modifier/target", () => {
    // Once a turn is open ANY Space release should commit it; finishPtt no-ops when
    // no turn is in flight, so an unmatched keyup is harmless.
    expect(shouldFinishHold(ev({ shiftKey: true, target: { tagName: "BUTTON" } }), "enter_push_to_talk")).toBe(true);
  });

  it("ignores non-Space releases and VAD mode", () => {
    expect(shouldFinishHold(ev({ key: "Enter", code: "Enter" }), "enter_push_to_talk")).toBe(false);
    expect(shouldFinishHold(ev(), "vad")).toBe(false);
  });
});

describe("isTypingTarget", () => {
  it("recognizes text-entry surfaces", () => {
    expect(isTypingTarget({ tagName: "INPUT" } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: "TEXTAREA" } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: "SELECT" } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true } as unknown as EventTarget)).toBe(true);
  });
  it("returns false for non-text elements and null", () => {
    expect(isTypingTarget({ tagName: "DIV" } as unknown as EventTarget)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
