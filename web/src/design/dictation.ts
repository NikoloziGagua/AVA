import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Dictation: speak into a draft, then edit it and send it yourself. Nothing is
 * ever sent automatically. The transcriber is passed in, so the design layer
 * never talks to the server directly.
 */

export type DictationState = "idle" | "requesting" | "listening" | "transcribing" | "error";
export type Transcribe = (audio: Blob, signal: AbortSignal) => Promise<string>;

export const MAX_DICTATION_MS = 90_000;
const DICTATION_MIMES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
] as const;

export function preferredDictationMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return DICTATION_MIMES.find((mime) => MediaRecorder.isTypeSupported?.(mime));
}

export function normalizedAudioMime(mime: string | undefined): string {
  const base = mime?.split(";", 1)[0]?.trim().toLowerCase();
  return base && ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav"].includes(base)
    ? base
    : "audio/webm";
}

export function insertDictation(draft: string, spoken: string): string {
  const transcript = spoken.trim();
  if (!transcript) return draft;
  if (!draft) return transcript;
  const separator = /\s$/.test(draft) ? "" : " ";
  return `${draft}${separator}${transcript}`;
}

export function describeDictationError(error: unknown): string {
  const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone permission was denied. Allow it for AVA, then try again.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No microphone was found on this device.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "The microphone is already in use or unavailable.";
  }
  return error instanceof Error ? error.message : "Dictation failed. Try recording again.";
}

/**
 * Records one clip, transcribes it and hands the words to `onText`. `enabled`
 * false (the screen that offered dictation went away) cancels whatever is in
 * flight, and so does unmounting.
 */
export function useDictation({ transcribe, onText, enabled = true }: {
  transcribe: Transcribe | undefined;
  onText: (transcript: string) => void;
  enabled?: boolean;
}) {
  const [state, setState] = useState<DictationState>("idle");
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);
  const mountedRef = useRef(true);
  const latest = useRef({ transcribe, onText });
  latest.current = { transcribe, onText };

  const releaseRecording = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    abortRef.current?.abort();
    abortRef.current = null;
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") recorder.stop();
    releaseRecording();
    chunksRef.current = [];
    if (mountedRef.current) {
      setState("idle");
      setError(null);
    }
  }, [releaseRecording]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancel();
    };
  }, [cancel]);

  useEffect(() => {
    if (!enabled || !transcribe) cancel();
  }, [enabled, transcribe, cancel]);

  const transcribeRecording = useCallback(async (recorder: MediaRecorder) => {
    releaseRecording();
    if (cancelledRef.current || !mountedRef.current) return;
    if (chunksRef.current.length === 0) {
      setState("error");
      setError("No audio was captured. Try recording again.");
      return;
    }
    const run = latest.current.transcribe;
    if (!run) return;
    setState("transcribing");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const audio = new Blob(chunksRef.current, { type: normalizedAudioMime(recorder.mimeType) });
      const transcript = await run(audio, controller.signal);
      if (cancelledRef.current || !mountedRef.current) return;
      latest.current.onText(transcript);
      setState("idle");
      setError(null);
    } catch (failure) {
      if (cancelledRef.current || !mountedRef.current) return;
      setState("error");
      setError(describeDictationError(failure));
    } finally {
      abortRef.current = null;
      chunksRef.current = [];
    }
  }, [releaseRecording]);

  const begin = useCallback(async () => {
    if (state === "requesting" || state === "listening" || state === "transcribing") return;
    setError(null);
    cancelledRef.current = false;
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setState("error");
      setError("This browser does not support microphone dictation.");
      return;
    }
    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
      if (cancelledRef.current || !mountedRef.current) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      streamRef.current = stream;
      chunksRef.current = [];
      const mimeType = preferredDictationMime();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        releaseRecording();
        if (!cancelledRef.current && mountedRef.current) {
          setState("error");
          setError("The browser could not record the microphone. Try again.");
        }
      };
      recorder.onstop = () => { void transcribeRecording(recorder); };
      recorder.start(250);
      setState("listening");
      timeoutRef.current = setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, MAX_DICTATION_MS);
    } catch (failure) {
      releaseRecording();
      if (!cancelledRef.current && mountedRef.current) {
        setState("error");
        setError(describeDictationError(failure));
      }
    }
  }, [state, releaseRecording, transcribeRecording]);

  const finish = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") recorder.stop();
  }, []);

  return { state, error, begin, finish, cancel };
}
