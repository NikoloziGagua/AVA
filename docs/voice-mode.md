# Voice mode

Voice uses OpenAI Realtime for natural speech-to-speech conversation and AVA's
normal action agent for computer work. It has the same tools as typed chat:
shell, files, the persistent AVA Chrome, Instagram, WhatsApp, computer-use,
memory, approvals, playbooks, and reasoning levels.

## Flow

```
mic (AudioWorklet PCM16 @24kHz)
  → WS /api/voice/realtime            (OpenAI gpt-realtime-2.1)
      · semantic_vad waits for a complete thought
      · gpt-4o-transcribe captions
      · create_response:false lets AVA validate each finished transcript
  → server transcript GATE
      · drops empty / too-short / too-brief / low-confidence / hallucination
      · rejected ⇒ no user turn and no spoken reply
  → structural turn policy
      · complete transcript ⇒ accepted user turn
      · incomplete fragment ⇒ visible pending caption; wait and join the continuation
      · expired/stale fragment ⇒ discard it; never turn it into a command
  ├─ conversation → realtime model speaks directly in the marin voice
  └─ action → do_on_computer(task)
       → POST /api/chat → the normal GPT-5.6 tool agent
       → tool steps are displayed but never spoken by a second voice
       → one cancellable action owns the connection; retired results are dropped
       → a non-empty terminal result returns to the same realtime model, which speaks it
  → browser plays one gapless PCM stream and truncates unheard audio on barge-in
```

Key files:
- `web/src/voice/useRealtimeVoice.ts` — capture, response gating, interruption,
  truncation, captions, approvals, and the silent text fallback.
- `web/src/voice/VoiceScreen.tsx` — calm single-caption UI, orb, status, mute,
  push-to-talk, and interrupt.
- `web/src/voice/realtime-audio.ts` — gapless PCM playback and the measured
  playhead used for OpenAI conversation truncation.
- `server/src/routes/voice-realtime.ts` — realtime proxy, transcript gate,
  semantic VAD, and action bridge.
- `server/src/voice/transcript-gate.ts` — the pure accept/reject policy.
- `server/src/voice/turn-policy.ts` — incomplete-turn detection, accumulation,
  replacement, and expiry.
- `server/src/voice/action-coordinator.ts` — single-action ownership,
  cancellation, and stale-result suppression.
- `server/src/voice/voiceConfig.ts` — separate natural Realtime and legacy TTS
  speech-rate defaults.
- `server/src/routes/voice.ts` — legacy STT/TTS primitives; not used to narrate
  Realtime action steps or results.

## Invariants (do not regress)

These are the whole point of the design. Each is backed by a test.

1. **Same action path as text.** Every voice request that needs a tool crosses
   `do_on_computer` into the same `POST /api/chat` action agent used by typed
   messages. There is no separate toolless action runner.

2. **Silence makes nothing.** A rejected transcript produces no browser event,
   no chat turn, and no reply. The gate is the single chokepoint, upstream of
   the browser and `response.create`.

3. **Only accepted speech interrupts.** Raw VAD onset does not cancel AVA:
   `interrupt_response:false` leaves the current reply alone while the
   transcript gate and structural completeness policy decide whether the sound
   was a real, complete owner turn. Once accepted, the server cancels
   generation and tells the browser to stop. The browser blocks late audio,
   sends `conversation.item.truncate` at the actual heard duration, and only
   re-arms playback for the accepted turn.

4. **One voice per turn.** Tool progress is visual only. The completed tool
   result is spoken by the same Realtime session and `marin` voice as the rest
   of the conversation. `/api/speak` is never inserted mid-task.

5. **Incomplete speech is visible but inert.** Hands-free fragments such as
   “I want you to go” appear as a pending caption and stay in the accumulator.
   AVA joins a continuation such as “into WhatsApp” before responding. A fresh
   complete command replaces a stale fragment; an expired fragment is deleted
   from model context and never executed.

6. **One action owns the connection.** Starting a replacement retires and
   aborts the prior `do_on_computer` run. Stop, socket close, and socket error do
   the same. Every step and result is epoch-checked, so a late promise from a
   cancelled action cannot update the UI, claim completion, or restart speech.

7. **Completion follows terminal evidence.** A computer action remains visibly
   busy until `/api/chat` emits a non-empty terminal `final` result and the
   result response starts, or the explicit silent text fallback displays that
   result. A tool-call `response.done`, arbitrary audio, or an interrupted run
   is not completion evidence. A failed stream or one with no final result is
   reported as a failure, never converted into “Done.” This proves the run
   reached a terminal result; it does not silently promote an unverified
   external outcome to independently verified.

8. **Stop is an explicit control.** While AVA is thinking, speaking, or running
   a computer action, the center control becomes Stop. It cancels the Realtime
   response, clears buffered input, stops local playback, kills the `/api/chat`
   run, and returns to listening without allowing a late result to resume.

9. **Realtime speech stays natural.** Realtime output uses the model-native
   `1.0` speed. The `1.15` preference belongs only to the legacy HTTP TTS route;
   it is not applied to the Realtime PCM stream.

`REALTIME_HYBRID` is a retired compatibility variable and does not change the
pipeline. Realtime speech plus the action bridge is the only supported mode.

## `/api/voice/turn` is intentionally absent

The old `POST /api/voice/turn` (+ `runVoiceTurn`, `useVoiceSession`) ran a
conversation-only, **toolless** model. It was deleted so voice can never
silently diverge from the tool-using agent. A regression test asserts the route
is gone (404). Do not reintroduce a voice endpoint that produces replies — route
transcripts through `/api/chat` instead.

## Endpointing modes

- **Hands-free VAD (default):** OpenAI `semantic_vad` waits for a semantically
  complete thought. The default `low` eagerness lets the owner pause without
  splitting “I want you to go … into WhatsApp” into two commands. Both Fast and
  Thorough reasoning keep semantic eagerness at `low`; the text-reasoning
  preference must not make endpointing aggressive. If OpenAI still splits a
  sentence, the structural accumulator holds and joins the pieces.
- **Push-to-talk:** mic frames are forwarded only while the talk button is held.
  Releasing explicitly commits the buffer. It reuses the same transcript gate
  and action bridge, but the explicit owner-chosen boundary bypasses incomplete
  fragment accumulation. Use it in noisy rooms.

## Env knobs

All optional; defaults are sane. Documented in `.env.example`.

Realtime VAD + transcription — `server/src/routes/voice-realtime.ts`
(`loadRealtimeVadConfig`):

| Var | Default | Meaning |
|---|---|---|
| `REALTIME_MODEL` | `gpt-realtime-2.1` | latest full realtime voice model |
| `REALTIME_VOICE` | `marin` | spoken voice; OpenAI recommends `marin` or `cedar` for best quality |
| `REALTIME_TRANSCRIBE_MODEL` | `gpt-4o-transcribe` | STT model (hallucinates less than whisper-1) |
| `REALTIME_TRANSCRIBE_LANGUAGE` | `en` | ISO-639-1 language hint; set `auto` to detect |
| `REALTIME_VAD_MODE` | `semantic_vad` | use `server_vad` only as a compatibility fallback |
| `REALTIME_VAD_EAGERNESS` | `low` | how quickly semantic VAD decides the owner finished |
| `REALTIME_VAD_THRESHOLD` | `0.6` | server-VAD fallback only: energy threshold |
| `REALTIME_VAD_PREFIX_PADDING_MS` | `300` | server-VAD fallback only: audio kept before onset |
| `REALTIME_VAD_SILENCE_MS` | `600` | base server-VAD fallback; reasoning mode raises it to 900/1200ms |

Realtime audio uses `DEFAULT_REALTIME_SPEECH_RATE = 1.0`. The separate
`DEFAULT_SPEECH_RATE = 1.15` applies only to legacy `/api/speak` clips.

Transcript gate — `server/src/voice/transcript-gate.ts`
(`loadTranscriptGateConfig`):

| Var | Default | Meaning |
|---|---|---|
| `VOICE_MIN_CHARS` | `2` | reject transcripts shorter than this |
| `VOICE_MIN_SPEECH_MS` | `200` | reject speech blips shorter than this |
| `VOICE_MAX_NO_SPEECH_PROB` | `0.6` | reject when transcriber says it's likely silence |
| `VOICE_MIN_AVG_LOGPROB` | `-1.2` | reject very low-confidence transcripts |
| `VOICE_HALLUCINATION_PHRASES` | (see source) | comma-separated phrase denylist |

Rejected transcripts are logged with a reason code and the (short) text only —
never raw audio.

## Manual smoke-test checklist

Open voice mode; watch the state label (top-left) and the server log.

1. **Silence 20s** — stay quiet. Expect: stays `LISTENING`, no captions, no
   reply. Log may show `dropped transcript reason=empty|hallucination_phrase`.
2. **Background noise** — TV/typing, no speech. Expect: no captions/reply; log
   shows `dropped … reason=…`.
3. **Paused command** — say "I want you to go", pause, then say "into
   WhatsApp". Expect: the first fragment is shown as pending with an ellipsis;
   no task starts until the continuation arrives; one combined command runs.
4. **Simple question** — "What's the date today?" Expect: `you` caption →
   `THINKING…` → `AVA · SPEAKING` spoken reply. No tools.
5. **Tool command** — "Open Chrome and go to github.com". Expect: tool activity
   caption, the action happens, spoken confirmation — same as typing it.
6. **One-voice task** — run a multi-step tool command. Expect: progress changes
   visually but is not narrated by another voice; only the final result is
   spoken, in the same `marin` Realtime voice as conversation.
7. **Approval-required command** — something destructive. Expect: an **Approval
   needed** card with Approve/Deny; nothing runs until you tap.
8. **Voice barge-in** — while AVA is speaking, say a clear complete sentence.
   Expect: her current audio stops after that transcript is accepted, its
   unheard tail does not resume, and the new sentence gets one reply. A cough
   or rejected noise transcript must not cut her off.
9. **Explicit Stop** — while AVA is speaking or a computer action is running,
   tap the center square Stop control. Expect: audio stops, the action is
   cancelled, state returns to `LISTENING`, and no late result appears or speaks.
10. **Honest failure** — force an action stream failure or missing terminal
    result. Expect: AVA reports that it did not work; the UI does not mark an
    early tool-call `response.done` as successful completion.
11. **Push-to-talk** — toggle PTT; hold the talk button, speak, release. Expect:
   audio only sent while held; same gate + agent behavior. Releasing without
   speaking produces nothing.
