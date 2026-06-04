import { describe, it, expect } from "vitest";
import {
  buildRealtimeSessionUpdate,
  loadRealtimeVadConfig,
  DEFAULT_REALTIME_VAD,
  readTranscriptionCompleted,
  speechDurationMs,
  decideTranscriptForward,
  forwardFrame,
} from "./voice-realtime.js";
import { DEFAULT_TRANSCRIPT_GATE } from "../voice/transcript-gate.js";

const TRANSCRIPT_TYPE = "conversation.item.input_audio_transcription.completed";
function transcriptEvt(transcript: string, extra: Record<string, unknown> = {}) {
  return { type: TRANSCRIPT_TYPE, transcript, ...extra };
}

describe("buildRealtimeSessionUpdate (transcribe-only GA schema)", () => {
  it("emits the GA nested session shape configured for transcription only", () => {
    const u = buildRealtimeSessionUpdate("be nice");
    expect(u.type).toBe("session.update");
    const s = u.session as Record<string, any>;
    expect(s.type).toBe("realtime");
    expect(s.instructions).toBe("be nice");
    // text-only output + no audio.output block => the realtime model never speaks
    expect(s.output_modalities).toEqual(["text"]);
    expect(s.audio.output).toBeUndefined();
    expect(s.audio.input.format).toEqual({ type: "audio/pcm", rate: 24000 });
    expect(s.audio.input.transcription.model).toBe(DEFAULT_REALTIME_VAD.transcribeModel);
  });

  it("tunes server VAD and disables auto-response (no reply to silence)", () => {
    const s = buildRealtimeSessionUpdate("x").session as Record<string, any>;
    const td = s.audio.input.turn_detection;
    expect(td.type).toBe("server_vad");
    expect(td.create_response).toBe(false);
    expect(td.interrupt_response).toBe(false);
    expect(td.threshold).toBe(DEFAULT_REALTIME_VAD.threshold);
    expect(td.prefix_padding_ms).toBe(DEFAULT_REALTIME_VAD.prefixPaddingMs);
    expect(td.silence_duration_ms).toBe(DEFAULT_REALTIME_VAD.silenceMs);
  });

  it("honors a supplied VAD config", () => {
    const s = buildRealtimeSessionUpdate("x", {
      transcribeModel: "whisper-1",
      threshold: 0.8,
      prefixPaddingMs: 100,
      silenceMs: 900,
    }).session as Record<string, any>;
    expect(s.audio.input.transcription.model).toBe("whisper-1");
    expect(s.audio.input.turn_detection.threshold).toBe(0.8);
    expect(s.audio.input.turn_detection.silence_duration_ms).toBe(900);
  });

  it("does NOT send the beta-shape fields that gpt-realtime rejects", () => {
    const s = buildRealtimeSessionUpdate("x").session as Record<string, any>;
    expect(s.modalities).toBeUndefined();
    expect(s.voice).toBeUndefined();
    expect(s.input_audio_transcription).toBeUndefined();
  });
});

describe("loadRealtimeVadConfig", () => {
  it("falls back to defaults with an empty environment", () => {
    expect(loadRealtimeVadConfig({})).toEqual(DEFAULT_REALTIME_VAD);
  });

  it("applies env overrides", () => {
    const cfg = loadRealtimeVadConfig({
      REALTIME_TRANSCRIBE_MODEL: "whisper-1",
      REALTIME_VAD_THRESHOLD: "0.75",
      REALTIME_VAD_PREFIX_PADDING_MS: "250",
      REALTIME_VAD_SILENCE_MS: "800",
    });
    expect(cfg.transcribeModel).toBe("whisper-1");
    expect(cfg.threshold).toBe(0.75);
    expect(cfg.prefixPaddingMs).toBe(250);
    expect(cfg.silenceMs).toBe(800);
  });
});

describe("readTranscriptionCompleted", () => {
  it("extracts the transcript from a completed input-transcription event", () => {
    const r = readTranscriptionCompleted({
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "open chrome",
    });
    expect(r).toEqual({ text: "open chrome", avgLogprob: null });
  });

  it("averages logprobs when present", () => {
    const r = readTranscriptionCompleted({
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "hi",
      logprobs: [{ logprob: -0.2 }, { logprob: -0.4 }],
    });
    expect(r?.avgLogprob).toBeCloseTo(-0.3, 5);
  });

  it("returns null for non-transcription events", () => {
    expect(readTranscriptionCompleted({ type: "response.created" })).toBeNull();
    expect(readTranscriptionCompleted({ type: "input_audio_buffer.speech_started" })).toBeNull();
  });
});

describe("speechDurationMs", () => {
  it("computes duration from start + audio_end_ms", () => {
    expect(speechDurationMs(1000, { audio_end_ms: 1600 })).toBe(600);
  });
  it("clamps negatives to zero", () => {
    expect(speechDurationMs(2000, { audio_end_ms: 1000 })).toBe(0);
  });
  it("returns null when timing is unavailable", () => {
    expect(speechDurationMs(null, { audio_end_ms: 1600 })).toBeNull();
    expect(speechDurationMs(1000, {})).toBeNull();
  });
});

describe("decideTranscriptForward — the silence/hallucination chokepoint", () => {
  const gate = DEFAULT_TRANSCRIPT_GATE;

  it("passes non-transcript events through untouched", () => {
    const d = decideTranscriptForward({ type: "response.created" }, null, gate);
    expect(d.isTranscript).toBe(false);
    expect(d.forward).toBe(true);
    expect(d.reason).toBe("not_transcript");
  });

  it("does NOT forward an empty transcript (silence)", () => {
    const d = decideTranscriptForward(transcriptEvt(""), 1000, gate);
    expect(d.isTranscript).toBe(true);
    expect(d.forward).toBe(false);
    expect(d.reason).toBe("empty");
  });

  it("does NOT forward known whisper silence hallucinations", () => {
    for (const phrase of ["you", "Thank you.", "Thanks for watching", "Okay.", "..."]) {
      const d = decideTranscriptForward(transcriptEvt(phrase), 1000, gate);
      expect(d.forward, `expected "${phrase}" dropped`).toBe(false);
      expect(d.reason).toBe("hallucination_phrase");
    }
  });

  it("does NOT forward a transcript from a too-brief speech blip", () => {
    // speech_started at 1000ms, audio_end at 1080ms => 80ms < minSpeechMs
    const d = decideTranscriptForward(
      transcriptEvt("open chrome", { audio_end_ms: 1080 }),
      1000,
      gate,
    );
    expect(d.forward).toBe(false);
    expect(d.reason).toBe("too_brief");
    expect(d.speechMs).toBe(80);
  });

  it("DOES forward a real spoken command (the /api/chat path)", () => {
    const d = decideTranscriptForward(
      transcriptEvt("open chrome and search my downloads", { audio_end_ms: 2000 }),
      1000,
      gate,
    );
    expect(d.isTranscript).toBe(true);
    expect(d.forward).toBe(true);
    expect(d.accept).toBe(true);
    expect(d.text).toBe("open chrome and search my downloads");
  });
});

describe("forwardFrame", () => {
  it("preserves a text frame as text — OpenAI rejects binary frames", () => {
    const calls: Array<{ data: unknown; opts: unknown }> = [];
    const target = { send: (data: unknown, opts?: unknown) => { calls.push({ data, opts }); } };
    const payload = Buffer.from('{"type":"input_audio_buffer.append"}');
    forwardFrame(target as never, payload, false);
    expect(calls[0]!.data).toBe(payload);
    expect(calls[0]!.opts).toEqual({ binary: false });
  });

  it("preserves a binary frame as binary", () => {
    const calls: Array<{ opts: unknown }> = [];
    const target = { send: (_d: unknown, opts?: unknown) => { calls.push({ opts }); } };
    forwardFrame(target as never, Buffer.from([1, 2, 3]), true);
    expect(calls[0]!.opts).toEqual({ binary: true });
  });
});
