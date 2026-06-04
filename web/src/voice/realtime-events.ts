// Normalizes OpenAI Realtime server events into a small action union the voice
// hook can switch on. Crucially it accepts BOTH the GA event names and the
// older beta names:
//   beta  response.audio.delta            -> GA response.output_audio.delta
//   beta  response.audio_transcript.delta -> GA response.output_audio_transcript.delta
//   beta  response.audio_transcript.done  -> GA response.output_audio_transcript.done
// The client was listening for the beta names only, so after the GA cutover the
// audio chunks and Ava's captions were silently dropped even when the session
// connected. Handling both names makes playback resilient to the rename.

export type RealtimeAction =
  | { kind: "session"; sessionId: string; mode?: "hybrid" | "transcribe" }
  | { kind: "speech_started" }
  | { kind: "speech_stopped" }
  | { kind: "user_transcript"; text: string }
  | { kind: "action_started"; task: string }
  | { kind: "audio"; b64: string }
  | { kind: "response_created" }
  | { kind: "ava_transcript_delta"; text: string }
  | { kind: "ava_transcript_done"; text: string }
  | { kind: "response_done" }
  | { kind: "error"; message: string }
  | { kind: "ignore" };

export function classifyRealtimeEvent(evt: { type?: string;[k: string]: unknown }): RealtimeAction {
  const t = evt.type;
  if (!t) return { kind: "ignore" };

  switch (t) {
    case "ava.session": {
      const sid = evt.sessionId as string | undefined;
      const mode = evt.mode === "hybrid" || evt.mode === "transcribe" ? evt.mode : undefined;
      return sid ? { kind: "session", sessionId: sid, mode } : { kind: "ignore" };
    }
    case "ava.action": {
      const task = (evt.task as string | undefined) ?? "";
      return { kind: "action_started", task };
    }
    case "input_audio_buffer.speech_started":
      return { kind: "speech_started" };
    case "input_audio_buffer.speech_stopped":
      return { kind: "speech_stopped" };
    case "conversation.item.input_audio_transcription.completed": {
      const text = (evt.transcript as string | undefined) ?? "";
      return text ? { kind: "user_transcript", text } : { kind: "ignore" };
    }
    case "response.output_audio.delta":
    case "response.audio.delta": {
      const b64 = evt.delta as string | undefined;
      return b64 ? { kind: "audio", b64 } : { kind: "ignore" };
    }
    case "response.created":
      return { kind: "response_created" };
    case "response.output_audio_transcript.delta":
    case "response.audio_transcript.delta":
      return { kind: "ava_transcript_delta", text: (evt.delta as string | undefined) ?? "" };
    case "response.output_audio_transcript.done":
    case "response.audio_transcript.done":
      return { kind: "ava_transcript_done", text: (evt.transcript as string | undefined) ?? "" };
    case "response.done":
      return { kind: "response_done" };
    case "error": {
      const message =
        (evt.error as { message?: string } | undefined)?.message ??
        (evt.message as string | undefined) ??
        "realtime error";
      return { kind: "error", message };
    }
    default:
      return { kind: "ignore" };
  }
}
