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
  seedContentType,
  buildHumeSessionSettings,
  translateHumeEvent,
  humeAudioChunkToClientPcm,
  resamplePcm16,
  CLIENT_PCM_RATE,
  translateClientFrameToHume,
  humeToolResultFrame,
  VOICE_PERSONA_INSTRUCTIONS,
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

describe("Hume audio conversion (48k WAV → 24k client PCM)", () => {
  // Build a minimal PCM16 mono WAV at the given rate from int16 samples.
  function makeWav(rate: number, samples: number[]): Buffer {
    const data = Buffer.alloc(samples.length * 2);
    samples.forEach((s, i) => data.writeInt16LE(s, i * 2));
    const header = Buffer.alloc(44);
    header.write("RIFF", 0, "ascii");
    header.writeUInt32LE(36 + data.length, 4);
    header.write("WAVE", 8, "ascii");
    header.write("fmt ", 12, "ascii");
    header.writeUInt32LE(16, 16); // fmt chunk size
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(1, 22); // mono
    header.writeUInt32LE(rate, 24);
    header.writeUInt32LE(rate * 2, 28); // byte rate
    header.writeUInt16LE(2, 32); // block align
    header.writeUInt16LE(16, 34); // bits
    header.write("data", 36, "ascii");
    header.writeUInt32LE(data.length, 40);
    return Buffer.concat([header, data]);
  }

  it("strips the WAV header and downsamples 48k→24k (half the samples, averaged pairs)", () => {
    const wav = makeWav(48000, [0, 100, 200, 300, 400, 500, 600, 700]);
    const outB64 = humeAudioChunkToClientPcm(wav.toString("base64"));
    const out = Buffer.from(outB64, "base64");
    expect(out.length).toBe(8); // 8 src samples → 4 dst samples → 8 bytes
    expect(out.toString("ascii", 0, 4)).not.toBe("RIFF"); // header stripped
    const got = [out.readInt16LE(0), out.readInt16LE(2), out.readInt16LE(4), out.readInt16LE(6)];
    expect(got).toEqual([50, 250, 450, 650]); // pairwise averages
  });

  it("passes raw (non-WAV) PCM through unchanged", () => {
    const raw = Buffer.from([1, 2, 3, 4]).toString("base64");
    expect(humeAudioChunkToClientPcm(raw)).toBe(raw);
  });

  it("returns empty for empty input", () => {
    expect(humeAudioChunkToClientPcm("")).toBe("");
  });

  it("translateHumeEvent audio_output yields a 24k PCM delta, not the raw WAV", () => {
    const wav = makeWav(48000, [1000, -1000, 2000, -2000]);
    const t = translateHumeEvent({ type: "audio_output", data: wav.toString("base64") });
    expect(t.frames.length).toBe(1);
    const frame = JSON.parse(t.frames[0]!) as { type: string; delta: string };
    expect(frame.type).toBe("response.output_audio.delta");
    const pcm = Buffer.from(frame.delta, "base64");
    expect(pcm.length).toBe(4); // 4 src → 2 dst samples
  });

  it("resamplePcm16 is a no-op at the same rate and halves at 2:1", () => {
    const pcm = Buffer.alloc(8); // 4 samples
    [10, 20, 30, 40].forEach((v, i) => pcm.writeInt16LE(v, i * 2));
    expect(resamplePcm16(pcm, CLIENT_PCM_RATE, CLIENT_PCM_RATE).equals(pcm)).toBe(true);
    expect(resamplePcm16(pcm, 48000, 24000).length).toBe(4); // 4 → 2 samples
  });
});

describe("seedContentType — GA realtime content-part type for seeded turns", () => {
  it("uses output_text for assistant turns (GA rejects 'text')", () => {
    expect(seedContentType("assistant")).toBe("output_text");
  });
  it("uses input_text for user and system turns", () => {
    expect(seedContentType("user")).toBe("input_text");
    expect(seedContentType("system")).toBe("input_text");
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

describe("Hume EVI provider helpers", () => {
  it("buildHumeSessionSettings pins the voice by id when present", () => {
    const s = buildHumeSessionSettings("be ava", { apiKey: "k", configId: null, voiceId: "vid-1", voiceName: "Alice Bennett" });
    expect(s.type).toBe("session_settings");
    expect(s.system_prompt).toBe("be ava");
    expect(s.voice).toEqual({ provider: "HUME_AI", id: "vid-1" });
    expect(s.audio).toEqual({ encoding: "linear16", sample_rate: 24000, channels: 1 });
  });

  it("buildHumeSessionSettings falls back to the voice name (Alice Bennett) when no id", () => {
    const s = buildHumeSessionSettings("be ava", { apiKey: "k", configId: null, voiceId: null, voiceName: "Alice Bennett" });
    expect(s.voice).toEqual({ provider: "HUME_AI", name: "Alice Bennett" });
  });

  it("translateHumeEvent maps audio_output to the GA audio-delta frame", () => {
    const t = translateHumeEvent({ type: "audio_output", data: "BASE64PCM" });
    expect(JSON.parse(t.frames[0]!)).toEqual({ type: "response.output_audio.delta", delta: "BASE64PCM" });
  });

  it("translateHumeEvent surfaces a user transcript (for the gate) without a frame", () => {
    const t = translateHumeEvent({ type: "user_message", message: { role: "user", content: "open chrome" } });
    expect(t.userTranscript).toBe("open chrome");
    expect(t.frames).toEqual([]);
  });

  it("translateHumeEvent emits an assistant caption + assistantText to persist", () => {
    const t = translateHumeEvent({ type: "assistant_message", message: { role: "assistant", content: "On it Sir" } });
    expect(t.assistantText).toBe("On it Sir");
    expect(JSON.parse(t.frames[0]!)).toEqual({ type: "response.output_audio_transcript.done", transcript: "On it Sir" });
  });

  it("translateHumeEvent parses a tool_call", () => {
    const t = translateHumeEvent({ type: "tool_call", tool_call_id: "tc1", name: "do_on_computer", parameters: '{"task":"open downloads"}' });
    expect(t.toolCall).toEqual({ callId: "tc1", name: "do_on_computer", args: { task: "open downloads" } });
  });

  it("translateHumeEvent maps assistant_end to response.done and errors to an error frame", () => {
    expect(JSON.parse(translateHumeEvent({ type: "assistant_end" }).frames[0]!)).toEqual({ type: "response.done" });
    const err = JSON.parse(translateHumeEvent({ type: "error", slug: "bad_request" }).frames[0]!);
    expect(err.type).toBe("error");
  });

  it("translateHumeEvent ignores irrelevant messages", () => {
    expect(translateHumeEvent({ type: "user_interruption" }).frames).toEqual([]);
    expect(translateHumeEvent({ type: "chat_metadata" }).frames).toEqual([]);
  });

  it("translateClientFrameToHume converts mic append frames and drops the rest", () => {
    expect(JSON.parse(translateClientFrameToHume('{"type":"input_audio_buffer.append","audio":"AAA"}')!))
      .toEqual({ type: "audio_input", data: "AAA" });
    expect(translateClientFrameToHume('{"type":"input_audio_buffer.commit"}')).toBeNull();
    expect(translateClientFrameToHume("not json")).toBeNull();
  });

  it("humeToolResultFrame reports a tool_response", () => {
    expect(JSON.parse(humeToolResultFrame("tc1", "done"))).toEqual({ type: "tool_response", tool_call_id: "tc1", content: "done" });
  });

  it("VOICE_PERSONA_INSTRUCTIONS keeps 'Sir' natural and pacing snappy", () => {
    expect(VOICE_PERSONA_INSTRUCTIONS).toContain("Sir");
    expect(VOICE_PERSONA_INSTRUCTIONS.toLowerCase()).toContain("warm");
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
