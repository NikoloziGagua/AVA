// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  loadVoiceInputMode,
  saveVoiceInputMode,
  shouldForwardMic,
  shouldInterruptForNewTurn,
  shouldReopenListening,
  hasEnoughAudio,
  MIN_COMMIT_BYTES,
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

describe("shouldReopenListening — the hands-free recovery rule", () => {
  const base = { state: "responding", actionPending: false, playing: false, genDone: true, requireGenDone: true };

  it("fast path: reopens when generation is done and audio has drained", () => {
    expect(shouldReopenListening(base)).toBe(true);
  });

  it("fast path: does NOT reopen if response.done hasn't arrived", () => {
    expect(shouldReopenListening({ ...base, genDone: false })).toBe(false);
  });

  it("FALLBACK: reopens even without response.done (the missed-handshake bug)", () => {
    // This is the fix — hands-free recovers even if gen_done never came.
    expect(shouldReopenListening({ ...base, genDone: false, requireGenDone: false })).toBe(true);
  });

  it("never reopens while audio is still playing (no mid-reply cutoff)", () => {
    expect(shouldReopenListening({ ...base, playing: true })).toBe(false);
    expect(shouldReopenListening({ ...base, playing: true, requireGenDone: false })).toBe(false);
  });

  it("never reopens while a do_on_computer action is running", () => {
    expect(shouldReopenListening({ ...base, actionPending: true })).toBe(false);
    expect(shouldReopenListening({ ...base, actionPending: true, requireGenDone: false })).toBe(false);
  });

  it("only reopens from responding/thinking, never from listening/idle", () => {
    expect(shouldReopenListening({ ...base, state: "listening" })).toBe(false);
    expect(shouldReopenListening({ ...base, state: "idle" })).toBe(false);
    expect(shouldReopenListening({ ...base, state: "thinking" })).toBe(true);
  });
});

describe("hasEnoughAudio — the empty-commit guard", () => {
  it("100ms of PCM16@24kHz is the floor (4800 bytes)", () => {
    expect(MIN_COMMIT_BYTES).toBe(4800);
  });
  it("rejects an empty or too-short buffer (the '0.00ms' error)", () => {
    expect(hasEnoughAudio(0)).toBe(false);
    expect(hasEnoughAudio(4799)).toBe(false);
  });
  it("accepts a buffer at or over the floor", () => {
    expect(hasEnoughAudio(4800)).toBe(true);
    expect(hasEnoughAudio(48000)).toBe(true);
  });
});
