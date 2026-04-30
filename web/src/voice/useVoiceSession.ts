import { useCallback, useEffect, useRef, useState } from "react";
import { getToken } from "../auth/tokens.js";

export type VoiceState = "idle" | "listening" | "thinking" | "responding";

export interface VoiceCaption {
  who: "you" | "ava";
  text: string;
}

export function useVoiceSession({ initialSessionId }: { initialSessionId: string | null }) {
  const [state, setState] = useState<VoiceState>("idle");
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);
  const [caption, setCaption] = useState<VoiceCaption | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const sessionIdRef = useRef<string | null>(initialSessionId);

  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  const sendTurn = useCallback(async (blob: Blob) => {
    setState("thinking");
    const fd = new FormData();
    fd.append("audio", blob, "audio.webm");
    const token = getToken() ?? "";
    const sid = sessionIdRef.current;
    const url = `/api/voice/turn${sid ? `?sessionId=${sid}` : ""}`;
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: "POST",
        body: fd,
        headers: { authorization: `Bearer ${token}` },
      });
    } catch {
      setErrorMsg("network error");
      setState("idle");
      return;
    }
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      setErrorMsg((body as { error?: string }).error ?? `HTTP ${resp.status}`);
      setState("idle");
      return;
    }
    const j = (await resp.json()) as {
      sessionId: string;
      userText: string;
      assistantText: string;
      audio: string;
      audioMime: string;
    };
    setSessionId(j.sessionId);
    setCaption({ who: "you", text: j.userText });

    const bin = atob(j.audio);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const audioBlob = new Blob([buf], { type: j.audioMime });
    const audioUrl = URL.createObjectURL(audioBlob);
    const el = new Audio(audioUrl);
    audioElRef.current = el;
    setState("responding");
    setCaption({ who: "ava", text: j.assistantText });
    el.onended = () => {
      URL.revokeObjectURL(audioUrl);
      setState("idle");
    };
    el.play().catch(() => {
      setState("idle");
    });
  }, []);

  const startListening = useCallback(async () => {
    try {
      setErrorMsg(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        if (blob.size > 0) await sendTurn(blob);
        else setState("idle");
      };
      mediaRef.current = mr;
      mr.start();
      setState("listening");
    } catch {
      setErrorMsg("Microphone permission denied");
      setState("idle");
    }
  }, [sendTurn]);

  const stopListening = useCallback(() => {
    if (mediaRef.current && mediaRef.current.state !== "inactive") {
      mediaRef.current.stop();
      setState("thinking");
    }
  }, []);

  const stopResponding = useCallback(() => {
    audioElRef.current?.pause();
    audioElRef.current = null;
    setState("idle");
  }, []);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioElRef.current?.pause();
  }, []);

  return { state, sessionId, caption, errorMsg, startListening, stopListening, stopResponding };
}
