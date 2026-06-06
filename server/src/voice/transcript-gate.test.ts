import { describe, it, expect } from "vitest";
import {
  gateTranscript,
  loadTranscriptGateConfig,
  DEFAULT_TRANSCRIPT_GATE,
} from "./transcript-gate.js";

describe("gateTranscript", () => {
  it("accepts a normal sentence", () => {
    const r = gateTranscript({ text: "open Chrome and search my downloads" });
    expect(r.accept).toBe(true);
    expect(r.reason).toBe("ok");
  });

  it("normalizes whitespace in accepted text", () => {
    const r = gateTranscript({ text: "  run   this\n command  " });
    expect(r.text).toBe("run this command");
    expect(r.accept).toBe(true);
  });

  it("rejects empty / whitespace-only transcripts", () => {
    expect(gateTranscript({ text: "" }).reason).toBe("empty");
    expect(gateTranscript({ text: "   \n  " }).reason).toBe("empty");
    expect(gateTranscript({ text: "" }).accept).toBe(false);
  });

  it("rejects transcripts below the min char floor", () => {
    const r = gateTranscript({ text: "a" });
    expect(r.accept).toBe(false);
    expect(r.reason).toBe("too_short");
  });

  it("drops classic whisper silence hallucinations regardless of case/punctuation", () => {
    for (const phrase of ["you", "You.", "Thank you.", "thanks for watching", "Okay.", "..."]) {
      const r = gateTranscript({ text: phrase });
      expect(r.accept, `expected "${phrase}" to be rejected`).toBe(false);
      expect(r.reason).toBe("hallucination_phrase");
    }
  });

  it("does NOT drop a real phrase that merely contains a denylist word", () => {
    const r = gateTranscript({ text: "thank you for opening the file" });
    expect(r.accept).toBe(true);
  });

  it("rejects speech shorter than the min speech duration", () => {
    const r = gateTranscript({ text: "open chrome", speechMs: 80 });
    expect(r.accept).toBe(false);
    expect(r.reason).toBe("too_brief");
  });

  it("accepts when speech duration clears the floor", () => {
    const r = gateTranscript({ text: "open chrome", speechMs: 600 });
    expect(r.accept).toBe(true);
  });

  it("rejects high no-speech probability when reported", () => {
    const r = gateTranscript({ text: "open chrome", noSpeechProb: 0.95 });
    expect(r.accept).toBe(false);
    expect(r.reason).toBe("low_confidence");
  });

  it("rejects very low average logprob when reported", () => {
    const r = gateTranscript({ text: "open chrome", avgLogprob: -3.5 });
    expect(r.accept).toBe(false);
    expect(r.reason).toBe("low_confidence");
  });

  it("ignores confidence signals that are absent (null/undefined)", () => {
    const r = gateTranscript({ text: "open chrome", noSpeechProb: null, avgLogprob: undefined });
    expect(r.accept).toBe(true);
  });
});

describe("loadTranscriptGateConfig", () => {
  it("falls back to defaults with an empty environment", () => {
    expect(loadTranscriptGateConfig({})).toEqual(DEFAULT_TRANSCRIPT_GATE);
  });

  it("applies numeric env overrides", () => {
    const cfg = loadTranscriptGateConfig({
      VOICE_MIN_CHARS: "5",
      VOICE_MIN_SPEECH_MS: "400",
      VOICE_MAX_NO_SPEECH_PROB: "0.4",
      VOICE_MIN_AVG_LOGPROB: "-2",
    });
    expect(cfg.minChars).toBe(5);
    expect(cfg.minSpeechMs).toBe(400);
    expect(cfg.maxNoSpeechProb).toBe(0.4);
    expect(cfg.minAvgLogprob).toBe(-2);
  });

  it("parses a custom comma-separated phrase denylist", () => {
    const cfg = loadTranscriptGateConfig({ VOICE_HALLUCINATION_PHRASES: "foo, bar ,baz" });
    expect(cfg.hallucinationPhrases).toEqual(["foo", "bar", "baz"]);
  });

  it("ignores non-numeric overrides", () => {
    const cfg = loadTranscriptGateConfig({ VOICE_MIN_CHARS: "abc" });
    expect(cfg.minChars).toBe(DEFAULT_TRANSCRIPT_GATE.minChars);
  });
});
