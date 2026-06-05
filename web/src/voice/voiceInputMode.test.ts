// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  loadVoiceInputMode,
  saveVoiceInputMode,
  shouldForwardMic,
  shouldInterruptForNewTurn,
  DEFAULT_VOICE_INPUT_MODE,
} from "./voiceInputMode.js";

describe("voice input mode persistence", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to vad when nothing is stored", () => {
    expect(loadVoiceInputMode()).toBe("vad");
    expect(DEFAULT_VOICE_INPUT_MODE).toBe("vad");
  });

  it("round-trips a saved mode", () => {
    saveVoiceInputMode("enter_push_to_talk");
    expect(loadVoiceInputMode()).toBe("enter_push_to_talk");
    saveVoiceInputMode("vad");
    expect(loadVoiceInputMode()).toBe("vad");
  });

  it("falls back to the default on a garbage stored value", () => {
    localStorage.setItem("ava.voiceInputMode", "nonsense");
    expect(loadVoiceInputMode()).toBe("vad");
  });
});

describe("shouldForwardMic — the background-audio chokepoint", () => {
  it("never forwards while muted, in either mode", () => {
    expect(shouldForwardMic({ mode: "vad", muted: true, capturing: true, listening: true })).toBe(false);
    expect(shouldForwardMic({ mode: "enter_push_to_talk", muted: true, capturing: true, listening: true })).toBe(false);
  });

  it("VAD forwards only while listening", () => {
    expect(shouldForwardMic({ mode: "vad", muted: false, capturing: false, listening: true })).toBe(true);
    expect(shouldForwardMic({ mode: "vad", muted: false, capturing: false, listening: false })).toBe(false);
  });

  it("push-to-talk forwards ONLY while capturing — never between turns", () => {
    // Capturing a turn: audio flows regardless of the listening flag.
    expect(shouldForwardMic({ mode: "enter_push_to_talk", muted: false, capturing: true, listening: false })).toBe(true);
    // Between turns: nothing is sent, even though the session is "listening".
    expect(shouldForwardMic({ mode: "enter_push_to_talk", muted: false, capturing: false, listening: true })).toBe(false);
  });
});

describe("shouldInterruptForNewTurn", () => {
  it("interrupts only when Ava is mid-reply (speaking or thinking)", () => {
    expect(shouldInterruptForNewTurn("responding")).toBe(true);
    expect(shouldInterruptForNewTurn("thinking")).toBe(true);
  });
  it("does not interrupt when idle/listening/connecting", () => {
    expect(shouldInterruptForNewTurn("listening")).toBe(false);
    expect(shouldInterruptForNewTurn("idle")).toBe(false);
    expect(shouldInterruptForNewTurn("connecting")).toBe(false);
  });
});
