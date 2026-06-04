# Voice mode

Voice is a thin speech front-end on top of the **normal text agent**. It does
**not** have its own brain. Everything a typed message can do — shell, files,
browser, computer-use, memory, approvals, playbooks, reasoning levels — voice
gets for free, because an accepted voice transcript is submitted to the exact
same `POST /api/chat` endpoint a typed message uses.

## Flow

```
mic (AudioWorklet PCM16 @24kHz)
  → WS /api/voice/realtime            (OpenAI realtime, TRANSCRIBE-ONLY)
      · server_vad endpointing
      · whisper/gpt-4o-transcribe STT
      · create_response:false         (the realtime model NEVER speaks)
  → server transcript GATE            (server/src/voice/transcript-gate.ts)
      · drops empty / too-short / too-brief / low-confidence / hallucination
      · rejected ⇒ frame is NOT forwarded to the browser
  → browser (web/src/voice/useRealtimeVoice.ts)
      · accepted transcript ⇒ api.sendMessage(...) → POST /api/chat
  → normal tool-using agent (server/src/routes/chat.ts → runAgent)
      · SSE stream: thought / tool_call / approval_required / final / done
  → browser plays the `final` text via POST /api/speak  (TTS)
```

Key files:
- `web/src/voice/useRealtimeVoice.ts` — capture, mic gating, transcript→agent routing, TTS, approvals.
- `web/src/voice/VoiceScreen.tsx` — UI (state, captions, approval card, mute, push-to-talk).
- `server/src/routes/voice-realtime.ts` — transcribe-only realtime proxy + transcript gate wiring.
- `server/src/voice/transcript-gate.ts` — the pure accept/reject policy.
- `server/src/routes/voice.ts` — STT (`/transcribe`) + TTS (`/speak`) primitives only.

## Invariants (do not regress)

These are the whole point of the design. Each is backed by a test.

1. **Same agent path as text.** Voice transcripts MUST enter the same
   `POST /api/chat` agent path as typed messages. There is **no** separate
   conversational voice endpoint and **no** `tools: []` voice runner. The
   realtime model is transcribe-only and never generates a reply.
   - Client guard: `web/src/voice/useRealtimeVoice.intent.test.ts` — a gated
     transcript maps to `{ kind: "agent_turn" }`; every realtime
     audio/transcript/response event maps to `ignore`.
   - Endpoint guard: `server/src/routes/voice.test.ts` — `POST /api/voice/turn`
     returns **404** (see below).
   - **Hybrid exception:** when `REALTIME_HYBRID` is set, the realtime model
     speaks chit-chat directly for speed, but *actions* still route through
     `/api/chat` via the `do_on_computer` tool — so the capability guarantee
     holds. See "Hybrid mode" below. The default (flag off) keeps this invariant
     literally true.

2. **Silence makes nothing.** A rejected transcript produces no browser event,
   no chat turn, and no reply. The gate is the single chokepoint, upstream of
   the browser.
   - Guard: `server/src/routes/voice-realtime.test.ts` —
     `decideTranscriptForward` returns `forward:false` for empty / hallucination
     phrases / too-brief speech.

3. **TTS can't be re-heard.** Mic frames are forwarded upstream **only** while
   the client state is `listening`. During `thinking`/`responding` (Ava
   speaking) audio is dropped, so the TTS reply can't be transcribed back into a
   phantom turn.
   - Logic: `web/src/voice/useRealtimeVoice.ts`, AudioWorklet `onmessage`:
     `if (stateRef.current !== "listening") return;`. `speak()` sets
     `responding` before playback begins.

## Hybrid mode (opt-in, `REALTIME_HYBRID`)

The transcribe-only path is correct and capable but slow to *first sound*: the
reply only starts after the whole `/api/chat` run finishes and a TTS clip is
generated (~2–3s for "hi Ava"). Hybrid mode trades that for ChatGPT-style
latency on conversation **without losing capability on actions**.

**What changes:** the realtime model is configured to *speak* (`output_modalities:
["audio"]`) and is given exactly one tool, `do_on_computer`. For chit-chat it
replies in its own voice immediately (~0.3s). When you ask it to *do* something
it calls `do_on_computer`, the proxy runs the **real `/api/chat` agent** (full
tools, approvals, playbooks) over loopback, and feeds the result back so the
model speaks it.

```
mic → WS /api/voice/realtime  (hybrid: model speaks + has do_on_computer)
   · server_vad + transcript GATE   (unchanged: silence still makes nothing)
   · create_response:false → proxy sends response.create ONLY after the gate
     accepts a transcript, so a silence/noise blip can't trigger a spoken reply
   ├─ chit-chat → model speaks PCM16 audio directly
   │     → browser plays it gaplessly (web/src/voice/realtime-audio.ts)
   └─ action  → model calls do_on_computer(task)
         → proxy emits `ava.action` (UI shows progress)
         → runVoiceAction() → POST /api/chat → full agent → final text
         → proxy returns it as the tool result → model speaks it
```

**How the client knows the mode:** the proxy's first frame is
`sessionHelloFrame()` = `{ type:"ava.session", sessionId, mode }`. `mode:"hybrid"`
tells the browser to **play** the model's audio and **not** route transcripts to
`/api/chat`; `mode:"transcribe"` (default) keeps the old behavior. The client
latches this in `hybridRef` before handling any other frame.

Key files (additions):
- `server/src/routes/voice-realtime.ts` — `buildHybridSessionUpdate`,
  `DO_ON_COMPUTER_TOOL`, `readToolCall`, `toolResultFrames`, `sessionHelloFrame`,
  `actionStartedFrame`; the proxy runs hybrid when `deps.runAction` is provided.
- `server/src/index.ts` — `runVoiceAction()` (loopback `/api/chat` + SSE read),
  wired only when `REALTIME_HYBRID` is set.
- `web/src/voice/realtime-audio.ts` — `PcmStreamPlayer` (gapless 24kHz PCM16) +
  `pcm16Base64ToFloat32`.
- `web/src/voice/useRealtimeVoice.ts` — `realtimeActionToHybridEffect` + the
  hybrid turn-taking in `handleHybridAction`.

**Preserved invariants:** silence still makes nothing (same gate; `response.create`
is sent only *after* a transcript passes it), and actions still run the full
agent. **Relaxed:** the model now speaks conversation replies itself (invariant
#1's letter), which is the whole point.

**Known limitation:** voice barge-in (interrupting Ava by *speaking*) is not on
yet — the mic stays gated to `listening` while Ava speaks, so her audio can't be
re-transcribed (echo guard). Use the on-screen interrupt to cut her off; it stops
playback immediately. Opening the mic during playback (relying on browser echo
cancellation) is a deliberate follow-up, kept off until it can be tested live.

**Enable it:** set `REALTIME_HYBRID=1` (and optionally `REALTIME_VOICE`, e.g.
`alloy`/`marin`) in the server env, restart the server, reload the PWA. Unset to
return to the default transcribe-only path. Both are the *same* WebSocket route;
only the server's session config and the client's mode handling differ.

| Var | Default | Meaning |
|---|---|---|
| `REALTIME_HYBRID` | (unset) | when set, the realtime model speaks + gets `do_on_computer` |
| `REALTIME_VOICE` | `alloy` | spoken voice for the realtime model (hybrid only) |

## `/api/voice/turn` is intentionally absent

The old `POST /api/voice/turn` (+ `runVoiceTurn`, `useVoiceSession`) ran a
conversation-only, **toolless** model. It was deleted so voice can never
silently diverge from the tool-using agent. A regression test asserts the route
is gone (404). Do not reintroduce a voice endpoint that produces replies — route
transcripts through `/api/chat` instead.

## Endpointing modes

- **Hands-free VAD (default):** OpenAI `server_vad` detects start/stop; tuned
  thresholds + the gate keep silence/noise out.
- **Push-to-talk:** mic frames are forwarded only while the talk button is held.
  It reuses the **same** transcript gate and `/api/chat` route — it only changes
  *when* mic audio is sent. Releasing lets the trailing-silence VAD finalize the
  utterance. Use it in noisy rooms.

## Env knobs

All optional; defaults are sane. Documented in `.env.example`.

Realtime VAD + transcription — `server/src/routes/voice-realtime.ts`
(`loadRealtimeVadConfig`):

| Var | Default | Meaning |
|---|---|---|
| `REALTIME_MODEL` | `gpt-realtime` | realtime session model |
| `REALTIME_TRANSCRIBE_MODEL` | `gpt-4o-transcribe` | STT model (hallucinates less than whisper-1) |
| `REALTIME_VAD_THRESHOLD` | `0.6` | 0..1 energy gate; higher ignores more noise |
| `REALTIME_VAD_PREFIX_PADDING_MS` | `300` | audio kept before speech onset |
| `REALTIME_VAD_SILENCE_MS` | `600` | trailing silence that ends a turn |

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
3. **Simple question** — "What's the date today?" Expect: `you` caption →
   `THINKING…` → `AVA · SPEAKING` spoken reply. No tools.
4. **Tool command** — "Open Chrome and go to github.com". Expect: tool activity
   caption, the action happens, spoken confirmation — same as typing it.
5. **Approval-required command** — something destructive. Expect: an **Approval
   needed** card with Approve/Deny; nothing runs until you tap.
6. **Barge-in** — while Ava is speaking, tap the center pause button. TTS stops,
   the server run is killed, state returns to `LISTENING`.
7. **Push-to-talk** — toggle PTT; hold the talk button, speak, release. Expect:
   audio only sent while held; same gate + agent behavior. Releasing without
   speaking produces nothing.
