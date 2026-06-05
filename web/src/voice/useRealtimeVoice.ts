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
} from "./voiceInputMode.js";
import { shouldToggleOnEnter } from "./pushToTalk.js";
import { api, approveApproval, denyApproval } from "../api.js";

// OpenAI Realtime API uses 24kHz PCM16 mono in both directions.
const SAMPLE_RATE = 24000;

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
  // True while an Enter push-to-talk turn is actively being captured.
  const [capturing, setCapturing] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const captureCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const mutedRef = useRef(false);
  const inputModeRef = useRef<VoiceInputMode>(inputMode);
  const capturingRef = useRef(false);
  const sessionIdRef = useRef<string | null>(initialSessionId);
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

  // Sequential TTS queue: clips are generated + played in order, so we can speak
  // an instant ack and stream the reply sentence-by-sentence instead of waiting
  // for the whole answer plus one big TTS at the end. (Transcribe-only path.)
  const speakQueueRef = useRef<string[]>([]);
  const speakBusyRef = useRef(false);

  // HYBRID path: the proxy says `mode: "hybrid"` in its session hello when the
  // realtime model speaks directly. Then we play its PCM audio and DON'T route
  // transcripts to /api/chat. These refs drive that path; they stay inert in
  // transcribe-only mode.
  const hybridRef = useRef(false);
  const playerRef = useRef<PcmStreamPlayer | null>(null);
  const avaCaptionRef = useRef("");      // accumulates Ava's streamed transcript
  const genDoneRef = useRef(false);      // response.done seen for the current turn
  const actionPendingRef = useRef(false); // do_on_computer running (suppress early "listening")
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null); // end-of-turn debounce

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
    if (settleTimerRef.current) { clearTimeout(settleTimerRef.current); settleTimerRef.current = null; }

    try { wsRef.current?.close(); } catch { /* */ }
    wsRef.current = null;
  }, [stopAgentStream]);

  // Drain the speak queue: for each text, generate TTS and play it to completion
  // before the next, so ack + streamed sentences play in order without overlap.
  const speakWorker = useCallback(async () => {
    if (speakBusyRef.current) return;
    speakBusyRef.current = true;
    setState("responding");
    const token = getToken() ?? "";
    while (speakQueueRef.current.length > 0) {
      const text = speakQueueRef.current.shift()!;
      try {
        const resp = await fetch("/api/speak", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ text }),
        });
        if (resp.ok) {
          const url = URL.createObjectURL(await resp.blob());
          await new Promise<void>((resolve) => {
            const el = new Audio(url);
            ttsRef.current = el;
            const done = () => { URL.revokeObjectURL(url); if (ttsRef.current === el) ttsRef.current = null; resolve(); };
            el.onended = done;
            el.onerror = done;
            void el.play().catch(done);
          });
        }
      } catch { /* skip this clip */ }
    }
    speakBusyRef.current = false;
    if (stateRef.current === "responding") setState("listening");
  }, []);

  // Queue a phrase to be spoken. Worker is re-entrant-safe: a running drain
  // picks up new items; a fresh enqueue restarts it if idle.
  const enqueueSpeak = useCallback((text: string) => {
    const t = text.trim();
    if (!t) return;
    speakQueueRef.current.push(t);
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
      es.addEventListener("thought", (e) => {
        // Fix 4: stream the reply — speak the first complete sentence as soon as
        // it forms instead of waiting for the whole answer.
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
  }, []);
  // Debounced end-of-turn: only reopen the mic once Ava's audio has been silent
  // for a beat AND generation is done. A brief gap between audio chunks (network
  // jitter on a weak connection) won't trip it — new audio cancels the timer —
  // so Ava no longer cuts herself off mid-sentence by re-hearing her own tail.
  const scheduleListen = useCallback(() => {
    clearSettle();
    settleTimerRef.current = setTimeout(() => {
      settleTimerRef.current = null;
      if (
        genDoneRef.current &&
        !actionPendingRef.current &&
        !playerRef.current?.playing &&
        (stateRef.current === "responding" || stateRef.current === "thinking")
      ) {
        setState("listening");
      }
    }, 350);
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
        setSessionId(eff.sessionId);
        return;
      case "caption_user":
        // A fresh, gate-accepted user turn. Reset per-turn accumulators and go
        // to "thinking" right away (matches the transcribe path) so the mic
        // stops forwarding before Ava starts speaking — closes the echo window.
        // The server already sent response.create, so a response is guaranteed;
        // response.created/audio/done + onEnded carry us back to listening.
        clearSettle();
        actionPendingRef.current = false;
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
      case "thinking":
        genDoneRef.current = false;
        avaCaptionRef.current = "";
        setState("thinking");
        return;
      case "play_audio":
        clearSettle();              // new audio → cancel any pending end-of-turn
        actionPendingRef.current = false; // audio = Ava speaking the reply/result
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
  }, [ensurePlayer, clearSettle, scheduleListen]);

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
      const sid = sessionIdRef.current;
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${proto}//${location.host}/api/voice/realtime?t=${encodeURIComponent(token)}`
        + (sid ? `&sessionId=${encodeURIComponent(sid)}` : "")
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

  const stop = useCallback(() => {
    intentionalStopRef.current = true;
    reconnectRef.current = 0;
    setCapturing(false);
    cleanup();
    setState("idle");
    setCaption(null);
  }, [cleanup]);

  // Barge-in: stop Ava speaking / abort the in-flight agent run and return to
  // listening. Kills the server-side run too so tools don't keep executing.
  const interrupt = useCallback(() => {
    const sid = sessionIdRef.current;
    if (sid) void api.kill(sid).catch(() => {});
    stopAgentStream();
    // Hybrid: cut the model's spoken audio immediately and end the turn.
    try { playerRef.current?.interrupt(); } catch { /* */ }
    if (settleTimerRef.current) { clearTimeout(settleTimerRef.current); settleTimerRef.current = null; }
    genDoneRef.current = false;
    actionPendingRef.current = false;
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

  useEffect(() => () => { intentionalStopRef.current = true; cleanup(); }, [cleanup]);

  return {
    state,
    sessionId,
    caption,
    errorMsg,
    muted,
    setMuted,
    pendingApproval,
    approve,
    deny,
    start,
    stop,
    interrupt,
    // Input-mode (endpointing) controls.
    inputMode,
    setInputMode,
    capturing,
    togglePushToTalk,
  };
}
