import { describe, it, expect } from "vitest";
import { classifyRealtimeEvent } from "./realtime-events.js";

describe("classifyRealtimeEvent", () => {
  it("recognizes the GA output-audio delta (the rename that broke playback)", () => {
    expect(classifyRealtimeEvent({ type: "response.output_audio.delta", delta: "AAAA" }))
      .toEqual({ kind: "audio", b64: "AAAA" });
  });

  it("still recognizes the legacy beta audio delta", () => {
    expect(classifyRealtimeEvent({ type: "response.audio.delta", delta: "AAAA" }))
      .toEqual({ kind: "audio", b64: "AAAA" });
  });

  it("recognizes GA ava transcript delta + done", () => {
    expect(classifyRealtimeEvent({ type: "response.output_audio_transcript.delta", delta: "he" }))
      .toEqual({ kind: "ava_transcript_delta", text: "he" });
    expect(classifyRealtimeEvent({ type: "response.output_audio_transcript.done", transcript: "hello" }))
      .toEqual({ kind: "ava_transcript_done", text: "hello" });
  });

  it("maps user transcript, VAD, session and error events", () => {
    expect(classifyRealtimeEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "yo" }))
      .toEqual({ kind: "user_transcript", text: "yo" });
    expect(classifyRealtimeEvent({ type: "input_audio_buffer.speech_started" }))
      .toEqual({ kind: "speech_started" });
    expect(classifyRealtimeEvent({ type: "input_audio_buffer.speech_stopped" }))
      .toEqual({ kind: "speech_stopped" });
    expect(classifyRealtimeEvent({ type: "ava.session", sessionId: "s1" }))
      .toEqual({ kind: "session", sessionId: "s1" });
    expect(classifyRealtimeEvent({ type: "response.done" }))
      .toEqual({ kind: "response_done" });
    expect(classifyRealtimeEvent({ type: "error", error: { message: "boom" } }))
      .toEqual({ kind: "error", message: "boom" });
  });

  it("recognizes the Ava barge-in + recover control frames", () => {
    expect(classifyRealtimeEvent({ type: "ava.barge_in" })).toEqual({ kind: "barge_in" });
    expect(classifyRealtimeEvent({ type: "ava.recover", reason: "empty" }))
      .toEqual({ kind: "recover", reason: "empty" });
    // reason is optional → defaults to empty string
    expect(classifyRealtimeEvent({ type: "ava.recover" })).toEqual({ kind: "recover", reason: "" });
  });

  it("carries the proxy mode on the session hello (hybrid vs transcribe)", () => {
    expect(classifyRealtimeEvent({ type: "ava.session", sessionId: "s1", mode: "hybrid" }))
      .toEqual({ kind: "session", sessionId: "s1", mode: "hybrid" });
    expect(classifyRealtimeEvent({ type: "ava.session", sessionId: "s1", mode: "transcribe" }))
      .toEqual({ kind: "session", sessionId: "s1", mode: "transcribe" });
    // An unknown mode value is dropped (treated as no mode).
    expect(classifyRealtimeEvent({ type: "ava.session", sessionId: "s1", mode: "weird" }))
      .toEqual({ kind: "session", sessionId: "s1", mode: undefined });
  });

  it("recognizes the hybrid action-started frame", () => {
    expect(classifyRealtimeEvent({ type: "ava.action", task: "open downloads" }))
      .toEqual({ kind: "action_started", task: "open downloads" });
  });

  it("recognizes a per-step narration frame (tool + args)", () => {
    expect(classifyRealtimeEvent({ type: "ava.step", tool: "shell", args: { command: "ls" } }))
      .toEqual({ kind: "action_step", tool: "shell", args: { command: "ls" } });
  });

  it("ignores a step frame with no tool", () => {
    expect(classifyRealtimeEvent({ type: "ava.step", args: { command: "ls" } }))
      .toEqual({ kind: "ignore" });
  });

  it("recognizes the final action-result frame", () => {
    expect(classifyRealtimeEvent({ type: "ava.result", text: "Opened it, Sir." }))
      .toEqual({ kind: "action_result", text: "Opened it, Sir." });
  });

  it("ignores unknown events and missing types", () => {
    expect(classifyRealtimeEvent({ type: "something.else" })).toEqual({ kind: "ignore" });
    expect(classifyRealtimeEvent({})).toEqual({ kind: "ignore" });
  });
});
