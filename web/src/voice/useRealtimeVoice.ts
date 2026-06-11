import { useCallback, useEffect, useRef, useState } from "react";
import { getToken } from "../auth/tokens.js";
import { classifyRealtimeEvent, type RealtimeAction } from "./realtime-events.js";
import { PcmStreamPlayer } from "./realtime-audio.js";
import {
  type VoiceInputMode,
  loadVoiceInputMode,
  saveVoiceInputMode,
  shouldForwardMic,
  shouldInterruptForNewTurn,
  shouldReopenListening,
  reopenAfterSpeak,
  shouldReconnectForModeChange,
  shouldReconnectForEngineChange,
  shouldDropAudioDelta,
  hasEnoughAudio,
} from "./voiceInputMode.js";
import { shouldToggleOnEnter } from "./pushToTalk.js";
import { splitForSpeech } from "./speech-chunks.js";
import { humanizeTool } from "../chat/humanize.js";
import {
  api,
  approveApproval,
  denyApproval,
  fetchVoiceEngine,
  setVoiceEngine as apiSetVoiceEngine,
  type VoiceEngine,
} from "../api.js";

// OpenAI Realtime API uses 24kHz PCM16 mono in both directions.
const SAMPLE_RATE = 24000;

// Hands-free safety net: if Ava's "response.done" handshake is ever missed, the
// fast (genDone-gated) reopen never fires and the mic stays shut forever. This
// longer fallback reopens "listening" once she's been silent + idle this long,
// regardless of the missed event. Generous so a real reply is never clipped.
const REOPEN_FALLBACK_MS = 4000;

// What the voice client does with a (already gated) realtime event. The only
// path that produces a reply is `agent_turn` → POST /api/chat (the full
// tool-using agent) + TTS. Realtime audio / assistant-transcript / response
// events map to `ignore`: the realtime model is transcribe-only and never
// speaks, so there is no toolless voice-model reply path on the client either.
export type VoiceIntent =
  | { kind: "agent_turn"; text: string }
  | { kind: "session"; sessionId: string }
  | { kind: "error"; message: string }
  | { kind: "ignore" };

export function realtimeActionToIntent(action: RealtimeAction): VoiceIntent {
  switch (action.kind) {
    case "session":
      return action.sessionId ? { kind: "session", sessionId: action.sessionId } : { kind: "ignore" };
    case "user_transcript":
      return { kind: "agent_turn", text: action.text };
    case "error":
      return { kind: "error", message: action.message };
    default:
      // speech_started/stopped, audio, response_*, ava_transcript_* → ignore.
      return { kind: "ignore" };
  }
}

// HYBRID mode: the realtime model speaks directly (ChatGPT-fast), so the client
// PLAYS its audio + shows captions and must NOT re-route the transcript to
// /api/chat (the server already drove the model to reply, and routes any actual
// action through the do_on_computer tool). This pure map turns a realtime action
// into the side effect the hook performs; the stateful turn-taking lives in the
// hook.
export type HybridEffect =
  | { kind: "session"; sessionId: string }
  | { kind: "caption_user"; text: string }
  | { kind: "working"; task: string }
  | { kind: "step"; tool: string; args: unknown }
  | { kind: "result"; text: string }
  | { kind: "play_audio"; b64: string }
  | { kind: "ava_delta"; text: string }
  | { kind: "ava_done"; text: string }
  | { kind: "thinking" }
  | { kind: "gen_done" }
  | { kind: "error"; message: string }
  | { kind: "ignore" };

export function realtimeActionToHybridEffect(action: RealtimeAction): HybridEffect {
  switch (action.kind) {
    case "session":
      return action.sessionId ? { kind: "session", sessionId: action.sessionId } : { kind: "ignore" };
    case "user_transcript":
      return { kind: "caption_user", text: action.text };
    case "action_started":
      return { kind: "working", task: action.task };
    case "action_step":
      return { kind: "step", tool: action.tool, args: action.args };
    case "action_result":
      return { kind: "result", text: action.text };
    case "audio":
      return { kind: "play_audio", b64: action.b64 };
    case "ava_transcript_delta":
      return { kind: "ava_delta", text: action.text };
    case "ava_transcript_done":
      return { kind: "ava_done", text: action.text };
    case "response_created":
      return { kind: "thinking" };
    case "response_done":
      return { kind: "gen_done" };
    case "error":
      return { kind: "error", message: action.message };
    default:
      // speech_started / speech_stopped → ignore (mic gating owns turn-taking).
      return { kind: "ignore" };
  }
}

// The voice state machine. This single union is the one source of truth for
// where a session is; all UI derives from it (plus `capturing` for the PTT
// sub-state and `errorMsg` for the error surface) rather than scattered booleans.
// Transitions:
//   idle        → connecting            (start)
//   connecting  → listening | idle      (ws open ok / failure)   [reconnecting reuses "connecting"]
//   listening   → thinking              (turn finished: VAD endpoint or Enter commit)
//   thinking    → responding | listening(reply audio starts / empty reply)
//   responding  → listening             (Ava's audio drains)
//   any         → idle                  (stop / fatal close)
// Spec names map as: sending = "thinking", avaSpeaking = "responding",
// reconnecting = "connecting", error = `errorMsg` set.
export type RealtimeState = "idle" | "connecting" | "listening" | "thinking" | "responding";

export interface RealtimeCaption {
  who: "you" | "ava";
  text: string;
}

export interface PendingApproval {
  id: string;
  tool: string;
  summary: string;
}

// AudioWorklet processor source — registered as a Blob URL at module scope so
// it doesn't have to ship as a separate file. Captures the mic input channel,
// converts float32 [-1, 1] to PCM16 little-endian, and posts the bytes back
// to the main thread as a Uint8Array each render quantum (~128 samples).
const WORKLET_SRC = `
class PCM16Capture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch || ch.length === 0) return true;
    const out = new Int16Array(ch.length);
    for (let i = 0; i < ch.length; i++) {
      let s = Math.max(-1, Math.min(1, ch[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    this.port.postMessage(out.buffer, [out.buffer]);
    return true;
  }
}
registerProcessor("ava-pcm16-capture", PCM16Capture);
`;

let workletURL: string | null = null;
function ensureWorkletURL(): string {
  if (!workletURL) {
    workletURL = URL.createObjectURL(
      new Blob([WORKLET_SRC], { type: "application/javascript" }),
    );
  }
  return workletURL;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  // Process in chunks to avoid stack overflow on large buffers.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(s);
}

export function useRealtimeVoice({ initialSessionId }: { initialSessionId: string | null }) {
  const [state, setState] = useState<RealtimeState>("idle");
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);
  const [caption, setCaption] = useState<RealtimeCaption | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  // Endpointing mode. "vad" (default): hands-free server VAD. "enter_push_to_talk":
  // mic audio is sent ONLY while a turn is captured (Enter starts, Enter finishes);
  // background/external audio between turns is never transmitted. Persisted.
  const [inputMode, setInputModeState] = useState<VoiceInputMode>(() => loadVoiceInputMode());
  // How Ava's voice is produced (openai | chatterbox | hybrid). Server-persisted
  // (not localStorage): it changes the realtime "speaks vs transcribe" mode, so
  // it must be the same wherever Ava runs. Fetched on mount; a change POSTs it
  // and reconnects so the new realtime mode takes effect.
  const [voiceEngine, setVoiceEngineState] = useState<VoiceEngine>("openai");
  // True while an Enter push-to-talk turn is actively being captured.
  const [capturing, setCapturing] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const captureCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const mutedRef = useRef(false);
  const inputModeRef = useRef<VoiceInputMode>(inputMode);
  const prevInputModeRef = useRef<VoiceInputMode>(inputMode); // last mode we connected with (Bug A reconnect)
  const prevVoiceEngineRef = useRef<VoiceEngine>(voiceEngine); // last engine we connected with (reconnect on change)
  const capturingRef = useRef(false);
  const sessionIdRef = useRef<string | null>(initialSessionId);
  // When the user taps "+new", the next connect forces a fresh server session
  // (?new=1) instead of resuming the most-recent conversation. Consumed (reset)
  // once the server hands back the new session id.
  const forceNewRef = useRef(false);
  // Agent-turn plumbing: the SSE stream of the /api/chat run and the TTS player.
  const esRef = useRef<EventSource | null>(null);
  const ttsRef = useRef<HTMLAudioElement | null>(null);
  // Mic capture is only forwarded upstream while we're actively listening — so
  // Ava's own TTS reply (played on the speakers) can't be re-heard and
  // transcribed into a phantom turn.
  const stateRef = useRef<RealtimeState>("idle");

  useEffect(() => { mutedRef.current = muted; }, [muted]);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { capturingRef.current = capturing; }, [capturing]);

  // Persist the input mode and keep the ref in sync. When in push-to-talk and
  // not actively capturing, suspend the local mic tracks so nothing leaks
  // upstream between turns; VAD mode (or an in-progress capture) keeps them live.
  useEffect(() => {
    inputModeRef.current = inputMode;
    const tracks = streamRef.current?.getAudioTracks() ?? [];
    const enabled = inputMode === "enter_push_to_talk" ? capturing : true;
    for (const t of tracks) t.enabled = enabled;
  }, [inputMode, capturing]);

  const setInputMode = useCallback((m: VoiceInputMode) => {
    saveVoiceInputMode(m);
    setInputModeState(m);
  }, []);

  // Fetch the current engine on mount so the toggle reflects the active setting.
  useEffect(() => {
    let live = true;
    void fetchVoiceEngine()
      .then((e) => { if (live) { setVoiceEngineState(e); prevVoiceEngineRef.current = e; } })
      .catch(() => { /* keep the optimistic default */ });
    return () => { live = false; };
  }, []);

  // Change the engine: persist it server-side, then update local state. The
  // reconnect effect below applies the new realtime "speaks vs transcribe" mode
  // by reconnecting an active session. We set local state optimistically so the
  // toggle is responsive; a failed POST is non-fatal (voice keeps working).
  const setVoiceEngine = useCallback((e: VoiceEngine) => {
    setVoiceEngineState(e);
    void apiSetVoiceEngine(e).catch(() => { /* non-fatal */ });
  }, []);

  // Sequential TTS queue: clips are generated + played in order, so we can speak
  // an instant ack and stream the reply sentence-by-sentence instead of waiting
  // for the whole answer plus one big TTS at the end. (Transcribe-only path.)
  const speakQueueRef = useRef<string[]>([]);
  const speakBusyRef = useRef(false);
  const speakEpochRef = useRef(0);                       // bumped by interrupt() to abort an in-flight TTS drain
  const ttsDoneRef = useRef<(() => void) | null>(null);  // ends the current clip's await on barge-in

  // HYBRID path: the proxy says `mode: "hybrid"` in its session hello when the
  // realtime model speaks directly. Then we play its PCM audio and DON'T route
  // transcripts to /api/chat. These refs drive that path; they stay inert in
  // transcribe-only mode.
  const hybridRef = useRef(false);
  const playerRef = useRef<PcmStreamPlayer | null>(null);
  const avaCaptionRef = useRef("");      // accumulates Ava's streamed transcript
  const genDoneRef = useRef(false);      // response.done seen for the current turn
  const actionPendingRef = useRef(false); // do_on_computer running (suppress early "listening")
  const actionResultReceivedRef = useRef(false); // task's final result spoken (mic may reopen)
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null); // end-of-turn debounce
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null); // hands-free recovery (Fix 1)
  const pttBytesRef = useRef(0); // bytes forwarded in the current push-to-talk turn (Fix 3)
  // Barge-in epoch (Item 1). interrupt() bumps interruptEpochRef AND sends
  // response.cancel upstream so the realtime model stops generating. But late
  // audio deltas already in flight still arrive after the cancel; the realtime
  // speaking turn snapshots the epoch when it starts (playTurnEpochRef), and the
  // audio branch DROPS any delta whose snapshot is stale (epoch advanced since) so
  // a barged-in reply can't resume playing / re-arm "responding".
  const interruptEpochRef = useRef(0);
  const playTurnEpochRef = useRef(0);

  const stopAgentStream = useCallback(() => {
    try { esRef.current?.close(); } catch { /* */ }
    esRef.current = null;
    speakQueueRef.current = [];
    speakBusyRef.current = false;
    try { ttsRef.current?.pause(); } catch { /* */ }
    ttsRef.current = null;
  }, []);

  const cleanup = useCallback(() => {
    try { workletNodeRef.current?.port.close(); } catch { /* */ }
    try { workletNodeRef.current?.disconnect(); } catch { /* */ }
    workletNodeRef.current = null;

    try { sourceNodeRef.current?.disconnect(); } catch { /* */ }
    sourceNodeRef.current = null;

    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* */ }
    streamRef.current = null;

    try { captureCtxRef.current?.close(); } catch { /* */ }
    captureCtxRef.current = null;

    stopAgentStream();

    try { playerRef.current?.close(); } catch { /* */ }
    playerRef.current = null;
    hybridRef.current = false;
    avaCaptionRef.current = "";
    genDoneRef.current = false;
    actionPendingRef.current = false;
    actionResultReceivedRef.current = false;
    if (settleTimerRef.current) { clearTimeout(settleTimerRef.current); settleTimerRef.current = null; }
    if (fallbackTimerRef.current) { clearTimeout(fallbackTimerRef.current); fallbackTimerRef.current = null; }

    try { wsRef.current?.close(); } catch { /* */ }
    wsRef.current = null;
  }, [stopAgentStream]);

  // Synthesize one clip — null on any failure (the worker just skips it).
  const fetchClip = useCallback(async (text: string): Promise<Blob | null> => {
    try {
      const token = getToken() ?? "";
      const resp = await fetch("/api/speak", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ text }),
      });
      if (!resp.ok) return null;
      return await resp.blob();
    } catch {
      return null;
    }
  }, []);

  // Drain the speak queue: clips PLAY strictly in order, but clip N+1's TTS is
  // PREFETCHED while clip N plays — the old fetch-then-play serial loop put the
  // full synthesis latency (2-3s) of dead air between every clip. The epoch
  // guard covers prefetched-but-unplayed audio too: interrupt() bumps the epoch,
  // so an already-fetched blob is dropped, never played.
  const speakWorker = useCallback(async () => {
    if (speakBusyRef.current) return;
    speakBusyRef.current = true;
    setState("responding");
    const epoch = speakEpochRef.current;     // interrupt() bumps this to abort the drain
    let next: Promise<Blob | null> | null = null;
    while (speakEpochRef.current === epoch) {
      const pending =
        next ?? (speakQueueRef.current.length > 0 ? fetchClip(speakQueueRef.current.shift()!) : null);
      if (!pending) break;                          // queue drained
      next = null;
      const blob = await pending;
      if (speakEpochRef.current !== epoch) break;   // barged-in during the fetch
      // Start the NEXT clip's synthesis before this one plays.
      if (speakQueueRef.current.length > 0) next = fetchClip(speakQueueRef.current.shift()!);
      if (!blob) continue;                          // failed clip — skip it
      const url = URL.createObjectURL(blob);
      await new Promise<void>((resolve) => {
        const el = new Audio(url);
        ttsRef.current = el;
        const done = () => { URL.revokeObjectURL(url); if (ttsRef.current === el) ttsRef.current = null; ttsDoneRef.current = null; resolve(); };
        el.onended = done;
        el.onerror = done;
        ttsDoneRef.current = done;              // interrupt() calls this to end the clip's await
        void el.play().catch(done);
      });
    }
    speakBusyRef.current = false;
    ttsDoneRef.current = null;
    // Item 4: the speak queue can drain while Ava's REALTIME audio is still
    // playing (hybrid) or before her turn's generation is done — the scheduleListen
    // settle path already guards both, so the worker must too, or it reopens the
    // mic into a still-draining reply. reopenAfterSpeak owns the action-aware part
    // (chit-chat vs between task steps vs task fully narrated); we additionally
    // require no realtime audio still playing, and — in HYBRID only — that the
    // realtime response.done was seen. The pure-TTS transcribe path has no realtime
    // player (playing is false) and never sets genDone, so its existing reopen
    // semantics are preserved by gating genDone behind hybridRef.
    const wantReopen = reopenAfterSpeak({
      state: stateRef.current,
      actionPending: actionPendingRef.current,
      resultReceived: actionResultReceivedRef.current,
    }) === "reopen";
    const audioSettled = !playerRef.current?.playing;
    const genSettled = !hybridRef.current || genDoneRef.current;
    if (wantReopen && audioSettled && genSettled) {
      if (actionPendingRef.current) { actionPendingRef.current = false; actionResultReceivedRef.current = false; }
      setState("listening");
    }
  }, [fetchClip]);

  // Queue a phrase to be spoken. Worker is re-entrant-safe: a running drain
  // picks up new items; a fresh enqueue restarts it if idle. Long texts (the
  // monolithic task result especially) are sentence-split here so the first
  // sentence's clip plays while the rest are still synthesizing.
  const enqueueSpeak = useCallback((text: string) => {
    const chunks = splitForSpeech(text);
    if (chunks.length === 0) return;
    speakQueueRef.current.push(...chunks);
    void speakWorker();
  }, [speakWorker]);

  // Route an ACCEPTED transcript through the exact same backend path as a typed
  // message: POST /api/chat → full tool-using agent → SSE stream of the run. We
  // adopt the session id the server returns and speak the final reply.
  const runAgentTurn = useCallback((text: string) => {
    stopAgentStream();
    setCaption({ who: "you", text });
    setState("thinking");

    void (async () => {
      // Per-turn streaming state.
      let replyText = "";
      let firstSpoken = "";
      let acked = false;
      let sid: string;
      try {
        // voice:true → minimal reasoning on the server for a faster spoken reply
        // (full tool stack is unchanged).
        const r = await api.sendMessage(sessionIdRef.current, text, { voice: true });
        sid = r.sessionId;
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "send failed");
        setState("listening");
        return;
      }
      setSessionId(sid);

      const token = getToken() ?? "";
      const es = new EventSource(`/api/chat/${sid}/stream?t=${encodeURIComponent(token)}`);
      esRef.current = es;

      es.addEventListener("tool_call", (e) => {
        try {
          const p = JSON.parse((e as MessageEvent).data) as { tool: string };
          setCaption({ who: "ava", text: `…${p.tool}` });
          // Fix 1: the moment Ava starts doing something, say "on it" so the
          // wait isn't dead air. Fires once, ahead of the spoken reply.
          if (!acked) { acked = true; enqueueSpeak("On it, Sir."); }
        } catch { /* ignore */ }
      });
      es.addEventListener("delta", (e) => {
        // Fix 4: stream the reply — speak the first complete sentence as soon as
        // it forms instead of waiting for the whole answer. Streamed reply text
        // rides `delta`; `thought` events are reasoning summaries and must NEVER
        // be spoken.
        try {
          const p = JSON.parse((e as MessageEvent).data) as { text: string };
          replyText += p.text;
          if (!firstSpoken) {
            const m = /^[\s\S]*?[.!?](\s|$)/.exec(replyText);
            if (m && m[0].trim().length >= 10) { firstSpoken = m[0]; enqueueSpeak(firstSpoken); }
          }
        } catch { /* ignore */ }
      });
      es.addEventListener("approval_required", (e) => {
        try {
          const p = JSON.parse((e as MessageEvent).data) as { id: string; tool: string; summary: string };
          setPendingApproval({ id: p.id, tool: p.tool, summary: p.summary });
        } catch { /* ignore */ }
      });
      es.addEventListener("approval_resolved", (e) => {
        try {
          const p = JSON.parse((e as MessageEvent).data) as { id: string };
          setPendingApproval((cur) => (cur && cur.id === p.id ? null : cur));
        } catch { /* ignore */ }
      });
      es.addEventListener("final", (e) => {
        try {
          const p = JSON.parse((e as MessageEvent).data) as { text: string };
          setCaption({ who: "ava", text: p.text });
          // Speak whatever streaming hasn't already said: the rest after the
          // first sentence, or the whole reply if nothing streamed.
          const remainder = firstSpoken && p.text.startsWith(firstSpoken)
            ? p.text.slice(firstSpoken.length)
            : p.text;
          enqueueSpeak(remainder);
        } catch { /* ignore */ }
      });
      es.addEventListener("error", (e) => {
        // Two error sources land here: the SSE transport, and the agent's own
        // run-ending error event. Only the latter carries data.
        const data = (e as MessageEvent).data;
        if (data) {
          try {
            const p = JSON.parse(data) as { message: string };
            setErrorMsg(p.message);
          } catch { /* ignore */ }
          stopAgentStream();
          setState("listening");
        }
      });
      const finish = () => { stopAgentStream(); if (stateRef.current === "thinking") setState("listening"); };
      es.addEventListener("done", finish);
      es.addEventListener("killed", finish);
    })();
  }, [enqueueSpeak, stopAgentStream]);

  const clearSettle = useCallback(() => {
    if (settleTimerRef.current) { clearTimeout(settleTimerRef.current); settleTimerRef.current = null; }
    if (fallbackTimerRef.current) { clearTimeout(fallbackTimerRef.current); fallbackTimerRef.current = null; }
  }, []);
  // Debounced end-of-turn: only reopen the mic once Ava's audio has been silent
  // for a beat AND generation is done. A brief gap between audio chunks (network
  // jitter on a weak connection) won't trip it — new audio cancels the timer —
  // so Ava no longer cuts herself off mid-sentence by re-hearing her own tail.
  const scheduleListen = useCallback(() => {
    clearSettle();
    // Fast path: reopen promptly once generation is done AND audio has drained.
    settleTimerRef.current = setTimeout(() => {
      settleTimerRef.current = null;
      if (shouldReopenListening({
        state: stateRef.current,
        actionPending: actionPendingRef.current,
        playing: !!playerRef.current?.playing,
        genDone: genDoneRef.current,
        requireGenDone: true,
      })) setState("listening");
    }, 350);
    // Safety fallback (Fix 1): recover hands-free even if response.done was
    // missed — reopen once Ava's been silent + idle for REOPEN_FALLBACK_MS. New
    // audio cancels both timers (clearSettle in play_audio), so a real reply is
    // never clipped.
    fallbackTimerRef.current = setTimeout(() => {
      fallbackTimerRef.current = null;
      if (shouldReopenListening({
        state: stateRef.current,
        actionPending: actionPendingRef.current,
        playing: !!playerRef.current?.playing,
        genDone: genDoneRef.current,
        requireGenDone: false,
      })) setState("listening");
    }, REOPEN_FALLBACK_MS);
  }, [clearSettle]);

  // Lazily build the PCM player; its onEnded schedules the (debounced) end-of-turn
  // so the mic only reopens after Ava has truly finished — not during a jitter gap.
  const ensurePlayer = useCallback(() => {
    if (!playerRef.current) {
      const p = new PcmStreamPlayer();
      p.onEnded = () => { scheduleListen(); };
      // A single corrupt/undecodable audio delta is skipped by the player (it
      // keeps draining the rest). Surface it as a soft warning rather than
      // cutting Ava off — the next delta resumes the stream.
      p.onError = () => { console.warn("[ava] dropped an undecodable audio chunk"); };
      playerRef.current = p;
    }
    return playerRef.current;
  }, [scheduleListen]);

  // HYBRID turn-taking. The realtime model speaks; we play its audio + caption
  // it and never call /api/chat (the do_on_computer tool does any real work on
  // the server). State flips to thinking/responding so the mic stops forwarding
  // — that's the echo guard — and back to listening only when Ava's audio drains.
  const handleHybridAction = useCallback((action: RealtimeAction) => {
    const eff = realtimeActionToHybridEffect(action);
    switch (eff.kind) {
      case "session":
        // Got the (possibly newly-created) session id from the proxy — the
        // force-new request is now satisfied, so future reconnects resume it.
        forceNewRef.current = false;
        setSessionId(eff.sessionId);
        return;
      case "caption_user":
        // A fresh, gate-accepted user turn. Reset per-turn accumulators and go
        // to "thinking" right away (matches the transcribe path) so the mic
        // stops forwarding before Ava starts speaking — closes the echo window.
        // The server already sent response.create, so a response is guaranteed;
        // response.created/audio/done + onEnded carry us back to listening.
        clearSettle();
        // A genuinely new turn begins here: snapshot the current barge-in epoch so
        // this turn's audio is allowed to play. (Item 1 — a later interrupt() bumps
        // the epoch, which then strands any in-flight deltas from THIS turn.)
        playTurnEpochRef.current = interruptEpochRef.current;
        // Item 3: only clear the action guards for a genuinely NEW turn (no task
        // running). A do_on_computer task emits its tool-call response.done while
        // its tools are still executing; a transcript accepted in that window must
        // NOT clear actionPending/resultReceived, or the speak-queue/settle reopen
        // would fire mid-task → the mic reopens into the running task and Ava
        // re-hears herself. While a task is pending we leave the guards intact (the
        // task's own result will clear them when it finishes).
        if (!actionPendingRef.current) {
          actionResultReceivedRef.current = false;
        }
        avaCaptionRef.current = "";
        genDoneRef.current = false;
        setCaption({ who: "you", text: eff.text });
        setState("thinking");
        return;
      case "working":
        // do_on_computer is running on the server — show progress, keep the mic
        // closed, and don't let the tool-call response's done flip us to idle.
        actionPendingRef.current = true;
        setCaption({ who: "ava", text: eff.task ? `…${eff.task}` : "…working on it" });
        setState("thinking");
        return;
      case "step":
        actionPendingRef.current = true;
        {
          const phrase = humanizeTool(eff.tool, eff.args);
          setCaption({ who: "ava", text: phrase });
          enqueueSpeak(phrase);
        }
        return;
      case "result":
        actionResultReceivedRef.current = true;
        setCaption({ who: "ava", text: eff.text });
        // The mic reopens when the speak queue drains, so an empty result must
        // still enqueue a clip — otherwise hands-free would hang after the task.
        // Don't depend on the server's "Done." fallback for this safety property.
        enqueueSpeak(eff.text.trim() || "Done.");
        return;
      case "thinking":
        // A fresh generation (response.created) — refresh the turn's epoch snapshot
        // so its upcoming audio is allowed. A response.created always precedes a
        // post-barge-in reply, so this is the reliable "new speaking turn" marker
        // even when no new caption_user preceded it.
        playTurnEpochRef.current = interruptEpochRef.current;
        genDoneRef.current = false;
        avaCaptionRef.current = "";
        setState("thinking");
        return;
      case "play_audio":
        // Item 1 (barge-in): a late delta from a turn that was already barged-in
        // (interrupt() bumped the epoch after this turn's snapshot) must be DROPPED
        // — don't play it and DON'T re-arm "responding", or the realtime model's
        // cancelled tail resumes and Ava talks over Sir. (response.cancel upstream
        // stops further generation; this guards the deltas already in flight.)
        if (shouldDropAudioDelta(playTurnEpochRef.current, interruptEpochRef.current)) return;
        clearSettle();              // new audio → cancel any pending end-of-turn
        actionPendingRef.current = false; // audio = Ava speaking the reply/result
        actionResultReceivedRef.current = false;
        genDoneRef.current = false;
        setState("responding");
        ensurePlayer().enqueue(eff.b64);
        return;
      case "ava_delta":
        avaCaptionRef.current += eff.text;
        setCaption({ who: "ava", text: avaCaptionRef.current });
        return;
      case "ava_done":
        if (eff.text) setCaption({ who: "ava", text: eff.text });
        avaCaptionRef.current = "";
        return;
      case "gen_done":
        genDoneRef.current = true;
        // Don't end the turn on the raw event — debounce it. A tool-call response
        // also emits done (no audio, actionPending) and is correctly ignored; the
        // real reply ends via the audio draining + the settle timer.
        scheduleListen();
        return;
      case "error":
        setErrorMsg(eff.message);
        return;
      case "ignore":
        return;
    }
  }, [ensurePlayer, clearSettle, scheduleListen, enqueueSpeak]);

  const handleServerEvent = useCallback((evt: { type?: string;[k: string]: unknown }) => {
    const action = classifyRealtimeEvent(evt);
    // The session hello carries the proxy mode; latch it before branching so the
    // very first non-session frame is handled by the right path.
    if (action.kind === "session") {
      if (action.mode) hybridRef.current = action.mode === "hybrid";
      if (action.sessionId) setSessionId(action.sessionId);
      return;
    }
    if (hybridRef.current) {
      handleHybridAction(action);
      return;
    }
    // Transcribe-only (default): the realtime model is silent; an accepted
    // transcript is routed through the SAME tool-using agent as typed text.
    const intent = realtimeActionToIntent(action);
    switch (intent.kind) {
      case "agent_turn":
        runAgentTurn(intent.text);
        return;
      case "error":
        setErrorMsg(intent.message);
        return;
      default:
        return;
    }
  }, [handleHybridAction, runAgentTurn]);

  const startingRef = useRef(false);
  // Auto-reconnect on a transient abnormal close (e.g. 1006, or upstream 1011),
  // so a brief OpenAI-realtime blip self-heals instead of dead-ending on
  // "connection dropped". Capped at 2, reset on a healthy connect, and never
  // fired after an intentional stop / unmount.
  const reconnectRef = useRef(0);
  const intentionalStopRef = useRef(false);
  const startRef = useRef<() => void>(() => {});
  const start = useCallback(async () => {
    if (wsRef.current || startingRef.current) return; // dedupe StrictMode double-invoke
    startingRef.current = true;
    intentionalStopRef.current = false;
    setCapturing(false); // a fresh connection starts with no PTT turn in flight
    setErrorMsg(null);
    setState("connecting");

    try {
      // 1. Mic
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      // 2. WebSocket
      const token = getToken() ?? "";
      // "+new" forces a fresh session: drop any current id and tell the proxy not
      // to resume (?new=1). Otherwise a null id lets the proxy RESUME the most
      // recent conversation (voice<->chat shared memory).
      const forceNew = forceNewRef.current;
      const sid = forceNew ? null : sessionIdRef.current;
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${proto}//${location.host}/api/voice/realtime?t=${encodeURIComponent(token)}`
        + (sid ? `&sessionId=${encodeURIComponent(sid)}` : "")
        + (forceNew ? "&new=1" : "")
        // Tell the proxy to disable automatic VAD/turn-detection in push-to-talk.
        + `&inputMode=${encodeURIComponent(inputModeRef.current)}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.addEventListener("open", async () => {
        try {
          // 3. Capture pipeline
          const captureCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
          captureCtxRef.current = captureCtx;
          // iOS Safari boots AudioContext suspended; explicit resume keeps
          // the first ~200ms of audio from being dropped.
          if (captureCtx.state === "suspended") await captureCtx.resume();
          await captureCtx.audioWorklet.addModule(ensureWorkletURL());

          const source = captureCtx.createMediaStreamSource(stream);
          sourceNodeRef.current = source;
          const node = new AudioWorkletNode(captureCtx, "ava-pcm16-capture");
          workletNodeRef.current = node;

          node.port.onmessage = (ev) => {
            // Single forwarding rule (see shouldForwardMic): VAD forwards while
            // "listening" (closed during thinking/responding so Ava's reply isn't
            // re-heard); push-to-talk forwards ONLY while a turn is being
            // captured, so background/external audio between turns never leaves
            // the device.
            if (!shouldForwardMic({
              mode: inputModeRef.current,
              muted: mutedRef.current,
              capturing: capturingRef.current,
              listening: stateRef.current === "listening",
            })) return;
            if (ws.readyState !== WebSocket.OPEN) return;
            const buf = ev.data as ArrayBuffer;
            // Fix 3: track how much real audio this push-to-talk turn forwarded,
            // so finishPtt can refuse to commit an empty/too-short buffer.
            if (inputModeRef.current === "enter_push_to_talk") pttBytesRef.current += buf.byteLength;
            const b64 = arrayBufferToBase64(buf);
            ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: b64 }));
          };

          source.connect(node);

          // eslint-disable-next-line no-console
          console.info("[ava] realtime ready: capture context up");
          reconnectRef.current = 0; // healthy connection — refill the retry budget
          // In push-to-talk, keep the mic suspended until the owner presses Enter
          // so the connection's first moments don't leak room audio upstream.
          if (inputModeRef.current === "enter_push_to_talk") {
            for (const t of stream.getAudioTracks()) t.enabled = false;
          }
          setState("listening");
        } catch (err) {
          setErrorMsg(`audio setup failed: ${err instanceof Error ? err.message : String(err)}`);
          cleanup();
          setState("idle");
        }
      });

      ws.addEventListener("message", (ev) => {
        const data = ev.data;
        if (typeof data !== "string") return;
        try {
          const evt = JSON.parse(data);
          handleServerEvent(evt);
        } catch { /* ignore non-JSON */ }
      });

      ws.addEventListener("error", (ev) => {
        // eslint-disable-next-line no-console
        console.error("[ava] WS error event", ev);
        setErrorMsg("connection error");
      });

      ws.addEventListener("close", (ev) => {
        // eslint-disable-next-line no-console
        console.warn(`[ava] WS closed: code=${ev.code} reason="${ev.reason || "(none)"}" wasClean=${ev.wasClean}`);
        startingRef.current = false;
        const authFail = ev.code === 1008 || ev.code === 4401;
        const transient = !authFail && (ev.code === 1006 || ev.code === 1011 || !ev.wasClean);
        if (!intentionalStopRef.current && transient && reconnectRef.current < 2) {
          reconnectRef.current += 1;
          // eslint-disable-next-line no-console
          console.warn(`[ava] voice dropped (${ev.code}) — reconnecting (attempt ${reconnectRef.current}/2)`);
          cleanup();
          setState("connecting");
          window.setTimeout(() => { if (!intentionalStopRef.current) startRef.current(); }, 800);
          return;
        }
        if (authFail) setErrorMsg("auth failed");
        else if (ev.code === 1011) setErrorMsg(`server error: ${ev.reason || "upstream rejected"}`);
        else if (ev.reason) setErrorMsg(ev.reason);
        else if (!ev.wasClean) setErrorMsg(`connection dropped (${ev.code})`);
        cleanup();
        setState("idle");
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg.includes("Permission") ? "microphone permission denied" : msg);
      cleanup();
      setState("idle");
    }
  }, [cleanup, handleServerEvent]);
  // Keep a stable handle to the latest start() for the reconnect timer.
  useEffect(() => { startRef.current = () => { void start(); }; }, [start]);

  // Bug A: when the endpointing mode changes mid-session, reconnect so the server
  // applies the new turn_detection. Push-to-talk must turn server VAD OFF; without
  // a reconnect the session keeps whatever mode it opened with — so silence ends
  // the turn and empty buffers get committed ("0.00ms"). A fresh start() reads the
  // mode from the URL, so only an already-active session needs this.
  useEffect(() => {
    const prev = prevInputModeRef.current;
    prevInputModeRef.current = inputMode;
    if (!shouldReconnectForModeChange(prev, inputMode, stateRef.current)) return;
    setCapturing(false);
    capturingRef.current = false;
    cleanup();
    setState("connecting");
    const t = window.setTimeout(() => { if (!intentionalStopRef.current) startRef.current(); }, 150);
    return () => window.clearTimeout(t);
  }, [inputMode, cleanup]);

  // Engine change → reconnect ONLY when it crosses the chatterbox boundary, since
  // that's the only switch that changes the realtime session the server builds at
  // CONNECT time: "chatterbox" makes the model transcribe-only; "openai"/"hybrid"
  // make it speak. openai↔hybrid build an IDENTICAL realtime session (they differ
  // only in the per-request /api/speak TTS for narrated steps/results), so
  // reconnecting on that switch would needlessly tear down a working session and
  // drop the mic. Same machinery as the input-mode reconnect above; only an
  // already-active session needs it (a fresh start() reads the engine server-side
  // on connect). We always advance prevVoiceEngineRef so the next change compares
  // against the current value even when we skip the reconnect.
  useEffect(() => {
    const prev = prevVoiceEngineRef.current;
    prevVoiceEngineRef.current = voiceEngine;
    if (!shouldReconnectForEngineChange(prev, voiceEngine, stateRef.current)) return;
    setCapturing(false);
    capturingRef.current = false;
    cleanup();
    setState("connecting");
    const t = window.setTimeout(() => { if (!intentionalStopRef.current) startRef.current(); }, 150);
    return () => window.clearTimeout(t);
  }, [voiceEngine, cleanup]);

  const stop = useCallback(() => {
    intentionalStopRef.current = true;
    reconnectRef.current = 0;
    setCapturing(false);
    cleanup();
    setState("idle");
    setCaption(null);
  }, [cleanup]);

  // "+new conversation": drop the current session and reconnect forcing a fresh
  // one (?new=1). Same teardown→reconnect dance as the engine-change effect, so
  // it reuses the proven reconnect path rather than inventing a new one.
  const newConversation = useCallback(() => {
    forceNewRef.current = true;
    setSessionId(null);
    sessionIdRef.current = null;
    intentionalStopRef.current = false; // we DO want the reconnect to fire
    reconnectRef.current = 0;
    setCapturing(false);
    capturingRef.current = false;
    setCaption(null);
    cleanup();
    setState("connecting");
    window.setTimeout(() => { if (!intentionalStopRef.current) startRef.current(); }, 150);
  }, [cleanup]);

  // Barge-in: stop Ava speaking / abort the in-flight agent run and return to
  // listening. Kills the server-side run too so tools don't keep executing.
  const interrupt = useCallback(() => {
    const sid = sessionIdRef.current;
    if (sid) void api.kill(sid).catch(() => {});
    stopAgentStream();
    // Item 1 (CRITICAL): in hybrid chit-chat Ava's voice IS the realtime model
    // streaming audio deltas. Stopping the local player/queue is not enough —
    // upstream keeps generating and the next delta resumes her. Tell the realtime
    // model to STOP: cancel the active response and clear any buffered input so it
    // doesn't immediately re-respond. Bump the interrupt epoch FIRST so any delta
    // racing in after this (already in flight before cancel lands) is dropped by
    // the audio branch instead of re-arming "responding".
    interruptEpochRef.current += 1;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: "response.cancel" })); } catch { /* */ }
      try { ws.send(JSON.stringify({ type: "input_audio_buffer.clear" })); } catch { /* */ }
    }
    // Hybrid: cut the model's spoken audio immediately and end the turn.
    try { playerRef.current?.interrupt(); } catch { /* */ }
    // Bug B: the realtime player isn't the only voice — task steps/results and
    // transcribe-path replies speak via TTS (/api/speak). Stop those too, or the
    // owner can't cut Ava off mid-sentence. Bump the epoch so the in-flight drain
    // aborts, drop the queue, halt the current clip, and end its await.
    speakEpochRef.current += 1;
    speakQueueRef.current.length = 0;
    try { ttsRef.current?.pause(); } catch { /* */ }
    ttsRef.current = null;
    ttsDoneRef.current?.();
    ttsDoneRef.current = null;
    if (settleTimerRef.current) { clearTimeout(settleTimerRef.current); settleTimerRef.current = null; }
    if (fallbackTimerRef.current) { clearTimeout(fallbackTimerRef.current); fallbackTimerRef.current = null; }
    genDoneRef.current = false;
    actionPendingRef.current = false;
    actionResultReceivedRef.current = false;
    avaCaptionRef.current = "";
    setState("listening");
  }, [stopAgentStream]);

  // ─── Enter push-to-talk turn-taking ────────────────────────────────────────
  // Start a turn: re-open the mic, and — because pressing Enter is an EXPLICIT
  // new turn — interrupt Ava if she's mid-reply (the only thing allowed to cut
  // her off in PTT mode; background audio never is, since it's never forwarded).
  const startPtt = useCallback(() => {
    if (inputModeRef.current !== "enter_push_to_talk") return;
    if (capturingRef.current) return;
    if (shouldInterruptForNewTurn(stateRef.current)) interrupt();
    // Fix 2: flip the ref the mic gate reads NOW, not a React render later — else
    // the first audio chunks are dropped and the turn commits empty.
    capturingRef.current = true;
    pttBytesRef.current = 0; // Fix 3: fresh byte count for this turn
    for (const t of streamRef.current?.getAudioTracks() ?? []) t.enabled = true;
    setCapturing(true);
    setState("listening");
  }, [interrupt]);

  // Finish a turn: stop appending mic audio immediately, suspend the local input
  // stream (so nothing more is captured), commit the buffered audio and let the
  // server transcribe + request Ava's reply. Nothing is sent again until the
  // next Enter press.
  const finishPtt = useCallback(() => {
    if (inputModeRef.current !== "enter_push_to_talk") return;
    if (!capturingRef.current) return;
    // Fix 3: a too-quick tap captured nothing — don't commit an empty buffer (the
    // server rejects it: "buffer too small … 0.00ms"). Keep the turn open so the
    // owner can simply keep talking and press Enter again.
    if (!hasEnoughAudio(pttBytesRef.current)) return;
    capturingRef.current = false; // Fix 2: stop forwarding immediately
    setCapturing(false);
    for (const t of streamRef.current?.getAudioTracks() ?? []) t.enabled = false;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      // Commit the manually-captured buffer. With server VAD disabled this is
      // what ends the turn: the server transcribes it, gates it, and (hybrid)
      // asks the model to reply / (transcribe) forwards it to the /api/chat agent.
      try { ws.send(JSON.stringify({ type: "input_audio_buffer.commit" })); } catch { /* */ }
    }
    setState("thinking");
  }, []);

  // The single Enter action: finish if a turn is in flight, otherwise start one.
  const togglePushToTalk = useCallback(() => {
    if (capturingRef.current) finishPtt();
    else startPtt();
  }, [finishPtt, startPtt]);

  // Bind Enter globally while in push-to-talk mode. shouldToggleOnEnter ignores
  // key-repeat (held Enter), modifier combos, and Enter typed in an input/
  // textarea/contenteditable so it never fights the keyboard composer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!shouldToggleOnEnter(e, inputModeRef.current)) return;
      e.preventDefault();
      togglePushToTalk();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePushToTalk]);

  const approve = useCallback(() => {
    setPendingApproval((cur) => {
      if (cur) void approveApproval(cur.id).catch(() => {});
      return null;
    });
  }, []);

  const deny = useCallback(() => {
    setPendingApproval((cur) => {
      if (cur) void denyApproval(cur.id).catch(() => {});
      return null;
    });
  }, []);

  // Dismiss the error surface WITHOUT leaving voice — the X button exits.
  const clearError = useCallback(() => setErrorMsg(null), []);

  useEffect(() => () => { intentionalStopRef.current = true; cleanup(); }, [cleanup]);

  return {
    state,
    sessionId,
    caption,
    errorMsg,
    clearError,
    muted,
    setMuted,
    pendingApproval,
    approve,
    deny,
    start,
    stop,
    interrupt,
    newConversation,
    // Input-mode (endpointing) controls.
    inputMode,
    setInputMode,
    capturing,
    togglePushToTalk,
    // Voice-engine (how Ava's voice is produced) controls.
    voiceEngine,
    setVoiceEngine,
  };
}
