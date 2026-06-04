import { useCallback, useEffect, useRef, useState } from "react";
import { getToken } from "../auth/tokens.js";
import { classifyRealtimeEvent, type RealtimeAction } from "./realtime-events.js";
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
  // Endpointing mode. "vad" (default): hands-free server VAD. "ptt": forward mic
  // only while the talk button is held — same gate + /api/chat path, just a
  // narrower window for when audio is sent. Good for noisy rooms.
  const [mode, setMode] = useState<"vad" | "ptt">("vad");
  const [pttHeld, setPttHeld] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const captureCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const mutedRef = useRef(false);
  const modeRef = useRef<"vad" | "ptt">("vad");
  const pttHeldRef = useRef(false);
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
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { pttHeldRef.current = pttHeld; }, [pttHeld]);

  const stopAgentStream = useCallback(() => {
    try { esRef.current?.close(); } catch { /* */ }
    esRef.current = null;
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

    try { wsRef.current?.close(); } catch { /* */ }
    wsRef.current = null;
  }, [stopAgentStream]);

  // Speak Ava's final reply via server TTS. Playback finishing returns us to
  // listening so the conversation flows hands-free.
  const speak = useCallback(async (text: string) => {
    const token = getToken() ?? "";
    try {
      const resp = await fetch("/api/speak", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ text }),
      });
      if (!resp.ok) { setState("listening"); return; }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const el = new Audio(url);
      ttsRef.current = el;
      setState("responding");
      el.onended = () => { URL.revokeObjectURL(url); if (ttsRef.current === el) ttsRef.current = null; setState("listening"); };
      el.onerror = () => { URL.revokeObjectURL(url); setState("listening"); };
      await el.play().catch(() => setState("listening"));
    } catch {
      setState("listening");
    }
  }, []);

  // Route an ACCEPTED transcript through the exact same backend path as a typed
  // message: POST /api/chat → full tool-using agent → SSE stream of the run. We
  // adopt the session id the server returns and speak the final reply.
  const runAgentTurn = useCallback((text: string) => {
    stopAgentStream();
    setCaption({ who: "you", text });
    setState("thinking");

    void (async () => {
      let sid: string;
      try {
        const r = await api.sendMessage(sessionIdRef.current, text);
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
          void speak(p.text);
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
  }, [speak, stopAgentStream]);

  const handleServerEvent = useCallback((evt: { type?: string;[k: string]: unknown }) => {
    const intent = realtimeActionToIntent(classifyRealtimeEvent(evt));
    switch (intent.kind) {
      case "session":
        setSessionId(intent.sessionId);
        return;
      case "agent_turn":
        // Server already gated this transcript — it's real speech. Route it
        // through the SAME agent as text. (Silence/noise never gets here.)
        runAgentTurn(intent.text);
        return;
      case "error":
        setErrorMsg(intent.message);
        return;
      case "ignore":
        return;
    }
  }, [runAgentTurn]);

  const startingRef = useRef(false);
  const start = useCallback(async () => {
    if (wsRef.current || startingRef.current) return; // dedupe StrictMode double-invoke
    startingRef.current = true;
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

          node.port.onmessage = (ev) => {
            if (mutedRef.current) return;
            // Only forward mic audio while actually listening. During thinking/
            // responding the mic stays "open" for barge-in detection but we drop
            // the chunks so Ava's TTS reply isn't transcribed back as a phantom
            // user turn.
            if (stateRef.current !== "listening") return;
            if (ws.readyState !== WebSocket.OPEN) return;
            const buf = ev.data as ArrayBuffer;
            const b64 = arrayBufferToBase64(buf);
            ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: b64 }));
          };

          source.connect(node);

          // eslint-disable-next-line no-console
          console.info("[ava] realtime ready: capture context up (transcribe-only)");
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
        if (ev.code === 1008 || ev.code === 4401) setErrorMsg("auth failed");
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

  const stop = useCallback(() => {
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
    setState("listening");
  }, [stopAgentStream]);

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

  useEffect(() => () => { cleanup(); }, [cleanup]);

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
  };
}
