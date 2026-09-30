// Browser side of the GPT-Live engine (agentroom proposal #22). GPT-Live is
// full duplex: the mic streams continuously, the reply audio arrives as one
// continuous stream, and the model itself decides when to speak and when to
// stop for Sir. So unlike useRealtimeVoice there is no turn gate here: this
// hook captures, plays, shows captions and maps the voice screen's controls
// (mute, hold-to-talk, Stop, typed text) onto AVA's live frames. It returns the
// same shape as useRealtimeVoice so VoiceScreen renders either engine.
import { useCallback, useEffect, useRef, useState } from "react";
import { getToken } from "../auth/tokens.js";
import type { ConversationIntent } from "../api.js";
import { PcmStreamPlayer } from "./realtime-audio.js";
import { claimFaceSignalWriter, type FaceSignalWriter } from "./faceSignal.js";
import { arrayBufferToBase64, ensureWorkletURL, pcm16Amplitude, type RealtimeState, type useRealtimeVoice } from "./useRealtimeVoice.js";
import { loadVoiceInputMode, saveVoiceInputMode, type VoiceInputMode } from "./voiceInputMode.js";

type VoiceApi = ReturnType<typeof useRealtimeVoice>;
const SAMPLE_RATE = 24000;
/** AVA counts as speaking this long after her last caption fragment. */
const SPEAKING_HOLD_MS = 900;

export function useLiveVoice({
  initialSessionId,
  intent,
  onSessionBound,
  onFallback,
}: {
  initialSessionId: string | null;
  intent?: ConversationIntent;
  onSessionBound?: (sessionId: string) => void;
  /** GPT-Live could not start; the screen switches to the standard engine. */
  onFallback?: () => void;
}): VoiceApi {
  const [state, setState] = useState<RealtimeState>("idle");
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);
  const [interim, setInterim] = useState<{ who: "you" | "ava"; text: string } | null>(null);
  const [amplitude, setAmplitude] = useState(0);
  const [hint, setHint] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [muted, setMutedState] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [inputMode, setInputModeState] = useState<VoiceInputMode>(() => loadVoiceInputMode());
  const [capturing, setCapturing] = useState(false);
  const faceWriterRef = useRef<FaceSignalWriter | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const playerRef = useRef<PcmStreamPlayer | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const sessionIdRef = useRef<string | null>(initialSessionId);
  const forceNewRef = useRef(intent === "new");
  const mutedRef = useRef(false);
  const capturingRef = useRef(false);
  const inputModeRef = useRef(inputMode);
  const speakingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actionRef = useRef(false);
  const lastAmpRef = useRef(0);
  const captionRef = useRef<{ who: "you" | "ava"; text: string } | null>(null);
  const fallbackRef = useRef(onFallback);
  fallbackRef.current = onFallback;
  const boundRef = useRef(onSessionBound);
  boundRef.current = onSessionBound;

  useEffect(() => {
    const writer = claimFaceSignalWriter("live");
    faceWriterRef.current = writer;
    return () => {
      if (faceWriterRef.current === writer) faceWriterRef.current = null;
      writer.release();
    };
  }, []);

  useEffect(() => {
    const writer = faceWriterRef.current;
    if (!writer) return;
    if (unavailable || errorMsg || state === "idle" || state === "connecting") {
      writer.setMode("idle");
      return;
    }
    const player = playerRef.current;
    if (player?.playing && !player.held) {
      writer.setOutputSource("measured", () => player.outputLevel);
      writer.setMode("speaking");
    } else if (state === "listening") {
      writer.setMode(muted || (inputMode === "enter_push_to_talk" && !capturing) ? "idle" : "listening");
    } else if (state === "thinking") {
      writer.setMode("thinking");
    } else {
      writer.setMode("thinking");
    }
  }, [capturing, errorMsg, inputMode, muted, state, unavailable]);

  const send = (event: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
  };
  /** Whether mic audio should reach GPT-Live right now. */
  const micOpen = () => !mutedRef.current && (inputModeRef.current !== "enter_push_to_talk" || capturingRef.current);
  const syncMute = () => send({ type: micOpen() ? "ava.live.unmute" : "ava.live.mute" });

  const settleState = useCallback(() => {
    setState(actionRef.current ? "thinking" : "listening");
  }, []);

  const cleanup = useCallback(() => {
    faceWriterRef.current?.reset();
    try { nodeRef.current?.port.close(); nodeRef.current?.disconnect(); } catch { /* */ }
    nodeRef.current = null;
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* */ }
    streamRef.current = null;
    try { void ctxRef.current?.close(); } catch { /* */ }
    ctxRef.current = null;
    try { playerRef.current?.close(); } catch { /* */ }
    playerRef.current = null;
    const ws = wsRef.current;
    wsRef.current = null;
    try { ws?.close(); } catch { /* */ }
    if (speakingTimerRef.current) clearTimeout(speakingTimerRef.current);
  }, []);

  const caption = (who: "you" | "ava", delta: string) => {
    const cur = captionRef.current;
    const next = cur && cur.who === who ? { who, text: (cur.text + delta).slice(-400) } : { who, text: delta.trimStart() };
    captionRef.current = next;
    setInterim(next);
  };

  const start = useCallback(async () => {
    if (wsRef.current) return;
    setErrorMsg(null);
    setState("connecting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      streamRef.current = stream;
      const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      ctxRef.current = ctx;
      await ctx.audioWorklet.addModule(ensureWorkletURL());
      if (ctx.state === "suspended") await ctx.resume();
      const source = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, "ava-pcm16-capture");
      nodeRef.current = node;
      node.port.onmessage = (ev: MessageEvent<ArrayBuffer>) => {
        const buf = ev.data;
        const now = performance.now();
        if (now - lastAmpRef.current > 80) {
          lastAmpRef.current = now;
          const level = micOpen() ? pcm16Amplitude(buf) : 0;
          setAmplitude(level);
          if (micOpen()) faceWriterRef.current?.publishInput(level, now);
        }
        // Continuous input keeps GPT-Live's timeline running; when the mic is
        // closed the server has muted input, so silence costs nothing.
        send({ type: "input_audio_buffer.append", audio: arrayBufferToBase64(micOpen() ? buf : new ArrayBuffer(buf.byteLength)) });
      };
      source.connect(node);

      const player = new PcmStreamPlayer();
      player.onEnded = () => { faceWriterRef.current?.setMode("thinking"); };
      playerRef.current = player;

      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const sid = sessionIdRef.current;
      const mode = forceNewRef.current ? "new" : sid ? "resume" : "continue";
      const url = `${proto}//${location.host}/api/voice/realtime?t=${encodeURIComponent(getToken() ?? "")}&engine=live`
        + (mode === "new" ? "&intent=new&new=1" : sid && mode === "resume" ? `&intent=resume&sessionId=${encodeURIComponent(sid)}` : "&intent=continue");
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onmessage = (msg) => {
        let evt: Record<string, any>;
        try { evt = JSON.parse(String(msg.data)); } catch { return; }
        switch (evt.type) {
          case "ava.session":
            forceNewRef.current = false;
            if (typeof evt.sessionId === "string") {
              sessionIdRef.current = evt.sessionId;
              setSessionId(evt.sessionId);
              boundRef.current?.(evt.sessionId);
            }
            syncMute();
            settleState();
            return;
          case "ava.session_error":
            if (evt.code === "live_unavailable") { cleanup(); fallbackRef.current?.(); return; }
            if (evt.code === "session_unavailable") setUnavailable(true);
            setErrorMsg(typeof evt.message === "string" ? evt.message : "Voice is unavailable.");
            return;
          case "response.output_audio.delta":
            if (typeof evt.delta === "string") {
              player.enqueue(evt.delta);
              setState("responding");
              faceWriterRef.current?.setOutputSource("measured", () => player.outputLevel);
              faceWriterRef.current?.setMode(player.held ? "thinking" : "speaking");
            }
            return;
          case "ava.live.transcript":
            if (typeof evt.delta !== "string") return;
            if (evt.speaker === "ava") {
              caption("ava", evt.delta);
              setState("responding");
              if (speakingTimerRef.current) clearTimeout(speakingTimerRef.current);
              speakingTimerRef.current = setTimeout(settleState, SPEAKING_HOLD_MS);
            } else {
              caption("you", evt.delta);
            }
            return;
          case "ava.action":
            actionRef.current = true;
            setActionPending(true);
            setState("thinking");
            return;
          case "ava.step":
            return;
          case "ava.result":
            actionRef.current = false;
            setActionPending(false);
            settleState();
            return;
          case "error":
            setHint(typeof evt.error?.message === "string" ? evt.error.message : "Voice hiccup.");
            return;
          default:
            return;
        }
      };
      ws.onclose = () => {
        if (wsRef.current === ws) { cleanup(); setState("idle"); }
      };
    } catch (err) {
      cleanup();
      setState("idle");
      setErrorMsg(err instanceof Error ? err.message : "Could not start the microphone.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanup, intent, settleState]);

  const stop = useCallback(() => {
    cleanup();
    setState("idle");
    setInterim(null);
    setActionPending(false);
    actionRef.current = false;
  }, [cleanup]);

  useEffect(() => () => cleanup(), [cleanup]);

  const interrupt = useCallback(() => {
    send({ type: "response.cancel" });
    try { playerRef.current?.interrupt(); } catch { /* */ }
    actionRef.current = false;
    setActionPending(false);
    setState("listening");
    faceWriterRef.current?.setMode("listening");
  }, []);

  const setMuted = useCallback((next: boolean) => {
    mutedRef.current = next;
    setMutedState(next);
    syncMute();
  }, []);

  const setInputMode = useCallback((mode: VoiceInputMode) => {
    inputModeRef.current = mode;
    setInputModeState(mode);
    saveVoiceInputMode(mode);
    syncMute();
  }, []);

  const startPtt = useCallback(() => {
    if (inputModeRef.current !== "enter_push_to_talk" || capturingRef.current) return;
    const ctx = ctxRef.current;
    if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => { /* */ });
    capturingRef.current = true;
    setCapturing(true);
    syncMute();
  }, []);

  const finishPtt = useCallback(() => {
    if (!capturingRef.current) return;
    capturingRef.current = false;
    setCapturing(false);
    syncMute();
  }, []);

  const submitExactText = useCallback(async (text: string) => {
    const clean = text.trim();
    if (!clean || !wsRef.current) return false;
    send({ type: "ava.live.text", text: clean });
    caption("you", clean);
    return true;
  }, []);

  const newConversation = useCallback(() => {
    cleanup();
    forceNewRef.current = true;
    sessionIdRef.current = null;
    setSessionId(null);
    setInterim(null);
    setTimeout(() => { void start(); }, 50);
  }, [cleanup, start]);

  const noop = useCallback(() => {}, []);
  return {
    state,
    sessionId,
    getSessionId: () => sessionIdRef.current,
    caption: interim,
    turns: [],
    interim,
    amplitude,
    hint,
    clearHint: () => setHint(null),
    errorMsg,
    clearError: () => setErrorMsg(null),
    muted,
    setMuted,
    pendingApproval: null,
    actionPending,
    approve: noop,
    deny: noop,
    start,
    stop,
    interrupt,
    submitExactText,
    newConversation,
    inputMode,
    setInputMode,
    capturing,
    startPtt,
    finishPtt,
    togglePushToTalk: () => (capturingRef.current ? finishPtt() : startPtt()),
    voiceEngine: "live",
    setVoiceEngine: noop,
    unavailable,
  } as unknown as VoiceApi;
}
