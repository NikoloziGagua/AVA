import { describe, it, expect } from "vitest";
import { buildRealtimeSessionUpdate, persistTranscriptEvent, forwardFrame } from "./voice-realtime.js";

describe("buildRealtimeSessionUpdate (GA gpt-realtime schema)", () => {
  it("emits the GA nested session shape", () => {
    const u = buildRealtimeSessionUpdate("be nice");
    expect(u.type).toBe("session.update");
    const s = u.session as Record<string, any>;
    expect(s.type).toBe("realtime");
    expect(s.instructions).toBe("be nice");
    expect(s.output_modalities).toEqual(["audio"]);
    expect(s.audio.input.format).toEqual({ type: "audio/pcm", rate: 24000 });
    expect(s.audio.input.turn_detection.type).toBe("server_vad");
    expect(s.audio.input.transcription.model).toBe("whisper-1");
    expect(s.audio.output.voice).toBe("alloy");
    // GA requires an explicit output rate — omitting it fails session.update
    // with "Missing required parameter: 'session.audio.output.format.rate'".
    expect(s.audio.output.format).toEqual({ type: "audio/pcm", rate: 24000 });
  });

  it("does NOT send the beta-shape fields that gpt-realtime rejects", () => {
    const s = buildRealtimeSessionUpdate("x").session as Record<string, any>;
    expect(s.modalities).toBeUndefined();
    expect(s.voice).toBeUndefined();
    expect(s.input_audio_transcription).toBeUndefined();
  });
});

describe("persistTranscriptEvent", () => {
  it("maps the GA assistant transcript-done event", () => {
    expect(
      persistTranscriptEvent({ type: "response.output_audio_transcript.done", transcript: "hello" }),
    ).toEqual({ role: "assistant", content: "hello" });
  });

  it("still maps the legacy beta assistant transcript event", () => {
    expect(
      persistTranscriptEvent({ type: "response.audio_transcript.done", transcript: "hi" }),
    ).toEqual({ role: "assistant", content: "hi" });
  });

  it("maps the user input-transcription event", () => {
    expect(
      persistTranscriptEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "yo" }),
    ).toEqual({ role: "user", content: "yo" });
  });

  it("ignores unrelated events and blank transcripts", () => {
    expect(persistTranscriptEvent({ type: "response.output_audio.delta", transcript: "" })).toBeNull();
    expect(persistTranscriptEvent({ type: "response.output_audio_transcript.done", transcript: "   " })).toBeNull();
    expect(persistTranscriptEvent({ type: "session.updated" })).toBeNull();
  });
});

describe("forwardFrame", () => {
  it("preserves a text frame as text — OpenAI rejects binary frames", () => {
    const calls: Array<{ data: unknown; opts: unknown }> = [];
    const target = { send: (data: unknown, opts?: unknown) => { calls.push({ data, opts }); } };
    // ws delivers a browser text frame as a Buffer; forwarding it without the
    // text flag re-frames it as binary, which OpenAI refuses.
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
