import { describe, it, expect } from "vitest";
import { shouldToggleOnEnter, isTypingTarget } from "./pushToTalk.js";

function ev(over: Partial<{ key: string; repeat: boolean; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean; target: unknown }> = {}) {
  return { key: "Enter", repeat: false, target: null, ...over } as Parameters<typeof shouldToggleOnEnter>[0];
}

describe("shouldToggleOnEnter", () => {
  it("toggles on a bare Enter in push-to-talk mode", () => {
    expect(shouldToggleOnEnter(ev(), "enter_push_to_talk")).toBe(true);
  });

  it("does nothing in VAD mode", () => {
    expect(shouldToggleOnEnter(ev(), "vad")).toBe(false);
  });

  it("ignores key-repeat (a held Enter)", () => {
    expect(shouldToggleOnEnter(ev({ repeat: true }), "enter_push_to_talk")).toBe(false);
  });

  it("ignores non-Enter keys", () => {
    expect(shouldToggleOnEnter(ev({ key: "a" }), "enter_push_to_talk")).toBe(false);
    expect(shouldToggleOnEnter(ev({ key: " " }), "enter_push_to_talk")).toBe(false);
  });

  it("ignores modifier+Enter so it doesn't collide with other shortcuts", () => {
    expect(shouldToggleOnEnter(ev({ shiftKey: true }), "enter_push_to_talk")).toBe(false);
    expect(shouldToggleOnEnter(ev({ metaKey: true }), "enter_push_to_talk")).toBe(false);
    expect(shouldToggleOnEnter(ev({ ctrlKey: true }), "enter_push_to_talk")).toBe(false);
  });

  it("does not fire while typing in an input/textarea/contenteditable", () => {
    expect(shouldToggleOnEnter(ev({ target: { tagName: "INPUT" } }), "enter_push_to_talk")).toBe(false);
    expect(shouldToggleOnEnter(ev({ target: { tagName: "TEXTAREA" } }), "enter_push_to_talk")).toBe(false);
    expect(shouldToggleOnEnter(ev({ target: { tagName: "DIV", isContentEditable: true } }), "enter_push_to_talk")).toBe(false);
  });

  it("still fires on a non-text element like a button or the body", () => {
    expect(shouldToggleOnEnter(ev({ target: { tagName: "BODY" } }), "enter_push_to_talk")).toBe(true);
    expect(shouldToggleOnEnter(ev({ target: { tagName: "BUTTON" } }), "enter_push_to_talk")).toBe(true);
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
