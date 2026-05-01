import { useCallback, useEffect, useRef, useState } from "react";
import { getToken } from "../auth/tokens.js";

// OpenAI Realtime API uses 24kHz PCM16 mono in both directions.
const SAMPLE_RATE = 24000;

export type RealtimeState = "idle" | "connecting" | "listening" | "thinking" | "responding";

export interface RealtimeCaption {
  who: "you" | "ava";
  text: string;
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

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export function useRealtimeVoice({ initialSessionId }: { initialSessionId: string | null }) {
  const [state, setState] = useState<RealtimeState>("idle");
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);
  const [caption, setCaption] = useState<RealtimeCaption | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const captureCtxRef = useRef<AudioContext | null>(null);
  const playCtxRef = useRef<AudioContext | null>(null);
  const playTimeRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const mutedRef = useRef(false);
  const sessionIdRef = useRef<string | null>(initialSessionId);
  const avaPartialRef = useRef("");

  useEffect(() => { mutedRef.current = muted; }, [muted]);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

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

    try { playCtxRef.current?.close(); } catch { /* */ }
    playCtxRef.current = null;
    playTimeRef.current = 0;

    try { wsRef.current?.close(); } catch { /* */ }
    wsRef.current = null;
  }, []);

  const playAudioChunk = useCallback((b64: string) => {
    const ctx = playCtxRef.current;
    if (!ctx) return;
    const buf = base64ToArrayBuffer(b64);
    const i16 = new Int16Array(buf);
    const f32 = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i++) f32[i] = i16[i]! / 32768;

    const audioBuffer = ctx.createBuffer(1, f32.length, SAMPLE_RATE);
    audioBuffer.copyToChannel(f32, 0);

    const src = ctx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(ctx.destination);

    const startAt = Math.max(playTimeRef.current, ctx.currentTime + 0.02);
    src.start(startAt);
    playTimeRef.current = startAt + audioBuffer.duration;
  }, []);

  const handleServerEvent = useCallback((evt: { type?: string;[k: string]: unknown }) => {
    const t = evt.type;
    if (!t) return;

    if (t === "ava.session") {
      const sid = evt.sessionId as string | undefined;
      if (sid) setSessionId(sid);
      return;
    }
    if (t === "input_audio_buffer.speech_started") {
      // eslint-disable-next-line no-console
      console.info("[ava] VAD: speech_started — you're being heard");
      setState("listening");
      avaPartialRef.current = "";
      return;
    }
    if (t === "input_audio_buffer.speech_stopped") {
      // eslint-disable-next-line no-console
      console.info("[ava] VAD: speech_stopped — generating response");
      setState("thinking");
      return;
    }
    if (t === "conversation.item.input_audio_transcription.completed") {
      const transcript = (evt.transcript as string | undefined) ?? "";
      if (transcript) setCaption({ who: "you", text: transcript });
      return;
    }
    if (t === "response.audio.delta") {
      const delta = evt.delta as string | undefined;
      if (delta) {
        playAudioChunk(delta);
        setState((s) => {
          if (s !== "responding") {
            // eslint-disable-next-line no-console
            console.info("[ava] first audio chunk received");
            return "responding";
          }
          return s;
        });
      }
      return;
    }
    if (t === "response.created") {
      // Server has started building a response — useful timing marker.
      // eslint-disable-next-line no-console
      console.info("[ava] response.created");
      return;
    }
    if (t === "response.audio_transcript.delta") {
      const delta = (evt.delta as string | undefined) ?? "";
      avaPartialRef.current += delta;
      setCaption({ who: "ava", text: avaPartialRef.current });
      return;
    }
    if (t === "response.audio_transcript.done") {
      const transcript = (evt.transcript as string | undefined) ?? avaPartialRef.current;
      if (transcript) setCaption({ who: "ava", text: transcript });
      return;
    }
    if (t === "response.done") {
      // Back to listening for the next user turn.
      setState("listening");
      avaPartialRef.current = "";
      return;
    }
    if (t === "error") {
      const message = (evt.error as { message?: string } | undefined)?.message
        ?? (evt.message as string | undefined)
        ?? "realtime error";
      setErrorMsg(message);
    }
  }, [playAudioChunk]);

  const start = useCallback(async () => {
    if (wsRef.current) return;
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
        + (sid ? `&sessionId=${encodeURIComponent(sid)}` : "");
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

          let chunkCount = 0;
          node.port.onmessage = (ev) => {
            if (mutedRef.current) return;
            if (ws.readyState !== WebSocket.OPEN) return;
            const buf = ev.data as ArrayBuffer;
            const b64 = arrayBufferToBase64(buf);
            ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: b64 }));
            chunkCount++;
            // ~187 quanta/sec at 24kHz with 128-sample render quantum
            if (chunkCount === 1) {
              // eslint-disable-next-line no-console
              console.info("[ava] mic chunk #1 sent — capture is live");
            } else if (chunkCount % 200 === 0) {
              // eslint-disable-next-line no-console
              console.info(`[ava] mic chunk #${chunkCount} (~${(chunkCount / 187).toFixed(1)}s of audio sent)`);
            }
          };

          source.connect(node);

          // 4. Playback context — also wake it up so the first response chunk
          // doesn't get queued behind a suspended-state delay.
          const playCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
          playCtxRef.current = playCtx;
          if (playCtx.state === "suspended") await playCtx.resume();
          // Schedule first chunk a hair into the future for jitter; subsequent
          // chunks chain off the previous end.
          playTimeRef.current = playCtx.currentTime + 0.04;

          // eslint-disable-next-line no-console
          console.info("[ava] realtime ready: capture + playback contexts up");
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

      ws.addEventListener("error", () => {
        setErrorMsg("connection error");
      });

      ws.addEventListener("close", (ev) => {
        if (ev.code === 1008 || ev.code === 4401) setErrorMsg("auth failed");
        else if (ev.code === 1011) setErrorMsg("server error");
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

  const stop = useCallback(() => {
    cleanup();
    setState("idle");
    setCaption(null);
  }, [cleanup]);

  const interrupt = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: "response.cancel" })); } catch { /* */ }
    }
    // Also drop any queued audio so playback stops immediately.
    playTimeRef.current = playCtxRef.current?.currentTime ?? 0;
    setState("listening");
  }, []);

  useEffect(() => () => { cleanup(); }, [cleanup]);

  return {
    state,
    sessionId,
    caption,
    errorMsg,
    muted,
    setMuted,
    start,
    stop,
    interrupt,
    // Aliases so existing VoiceScreen using useVoiceSession's API can swap in.
    startListening: start,
    stopListening: interrupt,
    stopResponding: interrupt,
  };
}
