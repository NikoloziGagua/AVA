// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  loadVoiceInputMode,
  saveVoiceInputMode,
  shouldForwardMic,
  shouldInterruptForNewTurn,
  shouldReopenListening,
  reopenAfterSpeak,
  shouldReconnectForModeChange,
  shouldReconnectForEngineChange,
  shouldDropAudioDelta,
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

describe("reopenAfterSpeak — reopen the mic after the TTS queue drains", () => {
  it("stays closed when not responding (queue drained while idle/thinking)", () => {
    expect(reopenAfterSpeak({ state: "thinking", actionPending: false, resultReceived: false })).toBe("stay");
    expect(reopenAfterSpeak({ state: "listening", actionPending: true, resultReceived: true })).toBe("stay");
  });

  it("reopens at once for normal chit-chat TTS (no action pending)", () => {
    expect(reopenAfterSpeak({ state: "responding", actionPending: false, resultReceived: false })).toBe("reopen");
  });

  it("stays closed between task steps (action pending, result not yet spoken)", () => {
    expect(reopenAfterSpeak({ state: "responding", actionPending: true, resultReceived: false })).toBe("stay");
  });

  it("reopens once the task result has been spoken (action fully narrated)", () => {
    expect(reopenAfterSpeak({ state: "responding", actionPending: true, resultReceived: true })).toBe("reopen");
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

describe("shouldReconnectForModeChange — PTT must re-apply server turn_detection", () => {
  it("reconnects when the mode actually changes mid-session", () => {
    expect(shouldReconnectForModeChange("vad", "enter_push_to_talk", "listening")).toBe(true);
    expect(shouldReconnectForModeChange("enter_push_to_talk", "vad", "responding")).toBe(true);
    expect(shouldReconnectForModeChange("vad", "enter_push_to_talk", "thinking")).toBe(true);
  });

  it("does NOT reconnect when the mode is unchanged", () => {
    expect(shouldReconnectForModeChange("vad", "vad", "listening")).toBe(false);
    expect(shouldReconnectForModeChange("enter_push_to_talk", "enter_push_to_talk", "listening")).toBe(false);
  });

  it("does NOT reconnect when idle — the next connect reads the mode from the URL", () => {
    expect(shouldReconnectForModeChange("vad", "enter_push_to_talk", "idle")).toBe(false);
  });
});

describe("shouldReconnectForEngineChange — openai<->hume changes the provider", () => {
  // The engine is now the provider toggle: openai (GA realtime) vs hume (Hume EVI)
  // speak over different upstream sockets, so any change must reconnect.
  it("reconnects on any openai<->hume change while live", () => {
    expect(shouldReconnectForEngineChange("openai", "hume", "listening")).toBe(true);
    expect(shouldReconnectForEngineChange("hume", "openai", "responding")).toBe(true);
    expect(shouldReconnectForEngineChange("hume", "openai", "thinking")).toBe(true);
  });

  it("does NOT reconnect when the engine is unchanged", () => {
    expect(shouldReconnectForEngineChange("openai", "openai", "listening")).toBe(false);
    expect(shouldReconnectForEngineChange("hume", "hume", "responding")).toBe(false);
  });

  it("does NOT reconnect when idle — the next connect reads the engine server-side", () => {
    expect(shouldReconnectForEngineChange("openai", "hume", "idle")).toBe(false);
    expect(shouldReconnectForEngineChange("hume", "openai", "idle")).toBe(false);
  });
});

describe("shouldDropAudioDelta — late realtime deltas after a barge-in are ignored", () => {
  // The play_audio/audio branch captures the interrupt epoch at the START of the
  // turn; if interrupt() advances the epoch mid-turn, every delta that arrives
  // afterwards must be DROPPED (not played, not re-arm "responding"), or the
  // realtime model talks over Sir despite the barge-in.
  it("keeps a delta whose epoch matches the turn's captured epoch", () => {
    expect(shouldDropAudioDelta(3, 3)).toBe(false);
  });
  it("drops a delta once the epoch has advanced (a barge-in happened)", () => {
    expect(shouldDropAudioDelta(3, 4)).toBe(true);
  });
  it("treats any epoch advance (not just +1) as a barge-in", () => {
    expect(shouldDropAudioDelta(0, 2)).toBe(true);
  });
});
