import { describe, it, expect } from "vitest";
import {
  DEFAULT_SPEECH_RATE,
  MIN_SPEECH_RATE,
  MAX_SPEECH_RATE,
  resolveSpeechRate,
} from "./voiceConfig.js";

describe("voice speech rate config", () => {
  it("defaults to a faster-than-neutral rate (Sir's preference)", () => {
    expect(DEFAULT_SPEECH_RATE).toBeGreaterThan(1.0);
    expect(DEFAULT_SPEECH_RATE).toBe(1.15);
  });

  it("falls back to the faster default when no rate is requested", () => {
    expect(resolveSpeechRate(undefined)).toBe(DEFAULT_SPEECH_RATE);
    expect(resolveSpeechRate(null)).toBe(DEFAULT_SPEECH_RATE);
    expect(resolveSpeechRate("nonsense")).toBe(DEFAULT_SPEECH_RATE);
  });

  it("honours an explicit in-range request", () => {
    expect(resolveSpeechRate(1.5)).toBe(1.5);
    expect(resolveSpeechRate("0.8")).toBe(0.8);
  });

  it("clamps out-of-range requests to the engine's accepted bounds", () => {
    expect(resolveSpeechRate(10)).toBe(MAX_SPEECH_RATE);
    expect(resolveSpeechRate(0.01)).toBe(MIN_SPEECH_RATE);
  });
});
