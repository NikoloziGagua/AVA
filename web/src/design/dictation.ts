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
 *
 * Every recording is its own run. Cancelling, failing, unmounting or starting
 * again retires the run, and every late callback from a retired run (a
 * recorder stop, a transcription answer or error) does nothing at all.
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
  const abortRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The current run; anything holding an older number is retired.
  const runRef = useRef(0);
  const mountedRef = useRef(true);
  const latest = useRef({ transcribe, onText });
  latest.current = { transcribe, onText };

  const current = (run: number) => run === runRef.current && mountedRef.current;

  const releaseRecording = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  const cancel = useCallback(() => {
    runRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    const recorder = recorderRef.current;
    releaseRecording();
    // Its onstop now belongs to a retired run and transcribes nothing.
    if (recorder?.state === "recording") recorder.stop();
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

  const transcribeRecording = useCallback(async (run: number, recorder: MediaRecorder, chunks: Blob[]) => {
    if (!current(run)) return;
    releaseRecording();
    if (chunks.length === 0) {
      setState("error");
      setError("No audio was captured. Try recording again.");
      return;
    }
    const send = latest.current.transcribe;
    if (!send) return;
    setState("transcribing");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const transcript = await send(new Blob(chunks, { type: normalizedAudioMime(recorder.mimeType) }), controller.signal);
      if (!current(run)) return;
      latest.current.onText(transcript);
      setState("idle");
      setError(null);
    } catch (failure) {
      if (!current(run)) return;
      setState("error");
      setError(describeDictationError(failure));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  // `current` only reads refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [releaseRecording]);

  const begin = useCallback(async () => {
    if (state === "requesting" || state === "listening" || state === "transcribing") return;
    const run = ++runRef.current;
    setError(null);
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
      if (!current(run)) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      streamRef.current = stream;
      // This run's audio only; a retired run can never read or clear it.
      const chunks: Blob[] = [];
      const mimeType = preferredDictationMime();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (current(run) && event.data.size > 0) chunks.push(event.data);
      };
      recorder.onerror = () => {
        if (!current(run)) return;
        // Retire the run first, so the stop that follows an error transcribes nothing.
        runRef.current += 1;
        releaseRecording();
        setState("error");
        setError("The browser could not record the microphone. Try again.");
      };
      recorder.onstop = () => { void transcribeRecording(run, recorder, chunks); };
      recorder.start(250);
      setState("listening");
      timeoutRef.current = setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, MAX_DICTATION_MS);
    } catch (failure) {
      if (!current(run)) return;
      releaseRecording();
      setState("error");
      setError(describeDictationError(failure));
    }
  // `current` only reads refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, releaseRecording, transcribeRecording]);

  const finish = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") recorder.stop();
  }, []);

  return { state, error, begin, finish, cancel };
}
