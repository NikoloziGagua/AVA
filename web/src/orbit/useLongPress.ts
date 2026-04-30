import { useCallback, useEffect, useRef, useState } from "react";

export interface UseLongPressOpts {
  thresholdMs: number;
  onTrigger: () => void;
}

export function useLongPress({ thresholdMs, onTrigger }: UseLongPressOpts) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAtRef = useRef<number>(0);
  const [progress, setProgress] = useState(0);

  const cancel = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setProgress(0);
  }, []);

  const onPointerDown = useCallback(() => {
    startedAtRef.current = Date.now();
    setProgress(0);
    intervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAtRef.current;
      setProgress(Math.min(1, elapsed / thresholdMs));
    }, 16);
    timeoutRef.current = setTimeout(() => {
      cancel();
      onTrigger();
    }, thresholdMs);
  }, [thresholdMs, onTrigger, cancel]);

  const onPointerUp = cancel;
  const onPointerLeave = cancel;
  const onPointerCancel = cancel;

  useEffect(() => () => cancel(), [cancel]);

  return {
    progress,
    handlers: { onPointerDown, onPointerUp, onPointerLeave, onPointerCancel },
  };
}
