import { describe, it, expect } from "vitest";
import {
  buildRealtimeSessionUpdate,
  buildHybridSessionUpdate,
  DO_ON_COMPUTER_TOOL,
  readToolCall,
  toolResultFrames,
  sessionHelloFrame,
  actionStartedFrame,
  loadRealtimeVadConfig,
  vadForReasoning,
  turnDetectionFor,
  DEFAULT_REALTIME_VAD,
  readTranscriptionCompleted,
  speechDurationMs,
  decideTranscriptForward,
  forwardFrame,
  chooseResumeOrNew,
} from "./voice-realtime.js";
import { DEFAULT_TRANSCRIPT_GATE } from "../voice/transcript-gate.js";
import { DEFAULT_VOICE } from "./voice-defaults.js";
import { DEFAULT_SPEECH_RATE } from "../voice/voiceConfig.js";

// Voices the OpenAI speech / realtime models expose that read as female. Used to
// prove the no-saved-preference default speaks with a female voice.
const FEMALE_VOICES = new Set(["nova", "shimmer", "coral", "sage", "fable"]);

describe("hybrid voice (speak + do_on_computer)", () => {
  it("session.update enables audio out, the tool, and keeps create_response false (gate controls replies)", () => {
    const u = buildHybridSessionUpdate("be ava", DEFAULT_REALTIME_VAD, "alloy") as {
      session: {
        output_modalities: string[];
        tools: Array<{ name: string }>;
        audio: { input: { turn_detection: { create_response: boolean } }; output: { voice: string } };
      };
    };
    expect(u.session.output_modalities).toContain("audio");
    expect(u.session.tools.map((t) => t.name)).toContain("do_on_computer");
    expect(u.session.audio.input.turn_detection.create_response).toBe(false);
    expect(u.session.audio.output.voice).toBe("alloy");
  });

  it("defaults the realtime spoken voice to a female voice when none is supplied", () => {
    const u = buildHybridSessionUpdate("be ava") as {
      session: { audio: { output: { voice: string; speed: number } } };
    };
    expect(u.session.audio.output.voice).toBe(DEFAULT_VOICE);
    expect(FEMALE_VOICES.has(u.session.audio.output.voice)).toBe(true);
    // The faster spoken-delivery preference must be preserved by the default.
    expect(u.session.audio.output.speed).toBe(DEFAULT_SPEECH_RATE);
  });

  it("readToolCall parses a completed do_on_computer function call", () => {
    const evt = { type: "response.output_item.done", item: { type: "function_call", call_id: "c1", name: "do_on_computer", arguments: '{"task":"open downloads"}' } };
    expect(readToolCall(evt)).toEqual({ callId: "c1", name: "do_on_computer", args: { task: "open downloads" } });
  });

  it("readToolCall returns null for non-tool events and tolerates bad JSON", () => {
    expect(readToolCall({ type: "response.output_audio.delta" })).toBeNull();
    const bad = { type: "response.output_item.done", item: { type: "function_call", call_id: "c", name: "do_on_computer", arguments: "{not json" } };
    expect(readToolCall(bad)).toEqual({ callId: "c", name: "do_on_computer", args: {} });
  });

  it("toolResultFrames returns a function_call_output then a response.create", () => {
    const [out, resp] = toolResultFrames("c1", "opened it").map((s) => JSON.parse(s));
    expect(out).toMatchObject({ type: "conversation.item.create", item: { type: "function_call_output", call_id: "c1", output: "opened it" } });
    expect(resp).toEqual({ type: "response.create" });
  });

  it("the action tool is named/described for actions only", () => {
    expect(DO_ON_COMPUTER_TOOL.name).toBe("do_on_computer");
    expect(DO_ON_COMPUTER_TOOL.parameters.required).toContain("task");
  });

  it("sessionHelloFrame tells the client the proxy mode so it knows who replies", () => {
    expect(JSON.parse(sessionHelloFrame("s1", true))).toEqual({ type: "ava.session", sessionId: "s1", mode: "hybrid" });
    expect(JSON.parse(sessionHelloFrame(null, false))).toEqual({ type: "ava.session", sessionId: null, mode: "transcribe" });
  });

  it("actionStartedFrame carries the task for an in-progress caption", () => {
    expect(JSON.parse(actionStartedFrame("open downloads"))).toEqual({ type: "ava.action", task: "open downloads" });
  });
});

describe("chooseResumeOrNew — voice session continuity", () => {
  it("resumes the most-recent session by default (voice<->chat shared memory)", () => {
    expect(chooseResumeOrNew(false, "sess-123")).toEqual({ resumeId: "sess-123" });
  });
  it("starts fresh when the client asks for a new conversation (?new=1)", () => {
    expect(chooseResumeOrNew(true, "sess-123")).toEqual({ resumeId: null });
  });
  it("creates a new session when there is no prior conversation to resume", () => {
    expect(chooseResumeOrNew(false, null)).toEqual({ resumeId: null });
  });
});

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

describe("enter_push_to_talk session mode (server VAD disabled)", () => {
  it("turnDetectionFor returns tuned server_vad in VAD mode", () => {
    const td = turnDetectionFor(DEFAULT_REALTIME_VAD, false) as Record<string, unknown>;
    expect(td).not.toBeNull();
    expect(td.type).toBe("server_vad");
    expect(td.create_response).toBe(false);
    expect(td.silence_duration_ms).toBe(DEFAULT_REALTIME_VAD.silenceMs);
  });

  it("turnDetectionFor returns null (no auto endpointing) in push-to-talk mode", () => {
    expect(turnDetectionFor(DEFAULT_REALTIME_VAD, true)).toBeNull();
  });

  it("transcribe-only: push-to-talk disables turn_detection but keeps transcription + format", () => {
    const s = buildRealtimeSessionUpdate("x", DEFAULT_REALTIME_VAD, { pushToTalk: true }).session as Record<string, any>;
    expect(s.audio.input.turn_detection).toBeNull();
    expect(s.audio.input.transcription.model).toBe(DEFAULT_REALTIME_VAD.transcribeModel);
    expect(s.audio.input.format).toEqual({ type: "audio/pcm", rate: 24000 });
    expect(s.output_modalities).toEqual(["text"]);
  });

  it("transcribe-only: the default (no opts) preserves existing VAD behaviour", () => {
    const s = buildRealtimeSessionUpdate("x").session as Record<string, any>;
    expect(s.audio.input.turn_detection.type).toBe("server_vad");
    expect(s.audio.input.turn_detection.create_response).toBe(false);
  });

  it("hybrid: push-to-talk disables turn_detection but keeps audio out + the tool", () => {
    const s = buildHybridSessionUpdate("be ava", DEFAULT_REALTIME_VAD, "shimmer", { pushToTalk: true }).session as Record<string, any>;
    expect(s.audio.input.turn_detection).toBeNull();
    expect(s.output_modalities).toContain("audio");
    expect(s.tools.map((t: { name: string }) => t.name)).toContain("do_on_computer");
    expect(s.audio.output.voice).toBe("shimmer");
  });

  it("hybrid: the default (no opts) preserves existing VAD behaviour", () => {
    const s = buildHybridSessionUpdate("be ava").session as Record<string, any>;
    expect(s.audio.input.turn_detection.type).toBe("server_vad");
    expect(s.audio.input.turn_detection.create_response).toBe(false);
  });
});

describe("vadForReasoning (the toggle tunes voice snappiness)", () => {
  it("fast = snappy (short silence wait), thorough = patient", () => {
    expect(vadForReasoning(DEFAULT_REALTIME_VAD, "fast").silenceMs).toBe(300);
    expect(vadForReasoning(DEFAULT_REALTIME_VAD, "thorough").silenceMs).toBe(700);
  });
  it("leaves the other VAD fields untouched", () => {
    const out = vadForReasoning(DEFAULT_REALTIME_VAD, "fast");
    expect(out.threshold).toBe(DEFAULT_REALTIME_VAD.threshold);
    expect(out.prefixPaddingMs).toBe(DEFAULT_REALTIME_VAD.prefixPaddingMs);
    expect(out.transcribeModel).toBe(DEFAULT_REALTIME_VAD.transcribeModel);
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
