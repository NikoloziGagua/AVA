import { describe, it, expect } from "vitest";
import { realtimeActionToIntent, realtimeActionToHybridEffect } from "./useRealtimeVoice.js";
import { classifyRealtimeEvent } from "./realtime-events.js";

// These guard the contract that voice replies ONLY come from the tool-using
// /api/chat agent (via `agent_turn`), never from a realtime voice model.

describe("realtimeActionToIntent", () => {
  it("routes a gated user transcript to the agent path", () => {
    const intent = realtimeActionToIntent({ kind: "user_transcript", text: "open chrome" });
    expect(intent).toEqual({ kind: "agent_turn", text: "open chrome" });
  });

  it("an accepted upstream transcription event resolves to an agent_turn", () => {
    const evt = {
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "run the build",
    };
    const intent = realtimeActionToIntent(classifyRealtimeEvent(evt));
    expect(intent.kind).toBe("agent_turn");
    if (intent.kind === "agent_turn") expect(intent.text).toBe("run the build");
  });

  it("NEVER turns realtime model audio/transcript/response events into a reply", () => {
    const modelReplyEvents = [
      { type: "response.output_audio.delta", delta: "AAAA" },
      { type: "response.audio.delta", delta: "AAAA" },
      { type: "response.output_audio_transcript.delta", delta: "hi" },
      { type: "response.audio_transcript.done", transcript: "hi there" },
      { type: "response.created" },
      { type: "response.done" },
    ];
    for (const evt of modelReplyEvents) {
      const intent = realtimeActionToIntent(classifyRealtimeEvent(evt));
      expect(intent.kind, `${evt.type} must not produce a reply`).toBe("ignore");
    }
  });

  it("does not route VAD speech events to the agent", () => {
    expect(realtimeActionToIntent({ kind: "speech_started" }).kind).toBe("ignore");
    expect(realtimeActionToIntent({ kind: "speech_stopped" }).kind).toBe("ignore");
  });

  it("maps session + error actions through", () => {
    expect(realtimeActionToIntent({ kind: "session", sessionId: "s1" })).toEqual({
      kind: "session",
      sessionId: "s1",
    });
    expect(realtimeActionToIntent({ kind: "error", message: "boom" })).toEqual({
      kind: "error",
      message: "boom",
    });
  });
});

// In HYBRID mode the realtime model speaks, so the SAME events map to playback /
// caption effects — and crucially a user transcript becomes a caption, NOT an
// /api/chat turn (the server already drove the reply). These guard that flip.
describe("realtimeActionToHybridEffect", () => {
  it("captions the user transcript instead of routing it to /api/chat", () => {
    expect(realtimeActionToHybridEffect({ kind: "user_transcript", text: "what's up" }))
      .toEqual({ kind: "caption_user", text: "what's up" });
  });

  it("turns model audio into a play_audio effect (it speaks here)", () => {
    expect(realtimeActionToHybridEffect(classifyRealtimeEvent({ type: "response.output_audio.delta", delta: "AAAA" })))
      .toEqual({ kind: "play_audio", b64: "AAAA" });
  });

  it("maps Ava transcript delta/done to captions and response lifecycle to state", () => {
    expect(realtimeActionToHybridEffect({ kind: "ava_transcript_delta", text: "he" }))
      .toEqual({ kind: "ava_delta", text: "he" });
    expect(realtimeActionToHybridEffect({ kind: "ava_transcript_done", text: "hello" }))
      .toEqual({ kind: "ava_done", text: "hello" });
    expect(realtimeActionToHybridEffect({ kind: "response_created" })).toEqual({ kind: "thinking" });
    expect(realtimeActionToHybridEffect({ kind: "response_done" })).toEqual({ kind: "gen_done" });
  });

  it("shows an incomplete automatic-VAD fragment without creating an agent turn", () => {
    expect(realtimeActionToHybridEffect({
      kind: "user_transcript_pending",
      text: "I want you to go",
    })).toEqual({
      kind: "caption_user_pending",
      text: "I want you to go",
    });
    expect(realtimeActionToIntent({
      kind: "user_transcript_pending",
      text: "I want you to go",
    })).toEqual({ kind: "ignore" });
  });

  it("maps the action-started frame to a working effect", () => {
    expect(realtimeActionToHybridEffect({ kind: "action_started", task: "open downloads" }))
      .toEqual({ kind: "working", task: "open downloads" });
  });

  it("maps a per-step frame to a step effect (client narrates it)", () => {
    expect(realtimeActionToHybridEffect({ kind: "action_step", tool: "shell", args: { command: "ls" } }))
      .toEqual({ kind: "step", tool: "shell", args: { command: "ls" } });
  });

  it("maps the action-result frame to a result effect (client speaks it)", () => {
    expect(realtimeActionToHybridEffect({ kind: "action_result", text: "Opened it, Sir." }))
      .toEqual({ kind: "result", text: "Opened it, Sir." });
  });

  it("ignores VAD speech events (mic gating owns turn-taking)", () => {
    expect(realtimeActionToHybridEffect({ kind: "speech_started" })).toEqual({ kind: "ignore" });
    expect(realtimeActionToHybridEffect({ kind: "speech_stopped" })).toEqual({ kind: "ignore" });
  });
});
