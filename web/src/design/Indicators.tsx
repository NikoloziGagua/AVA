import { useEffect, useRef, useState, type ReactNode } from "react";
import { computeReduced } from "../lib/motionPref.js";
import { cn } from "./cn.js";

export type Tone = "neutral" | "success" | "warning" | "danger" | "info";

const TONE: Record<Tone, string> = {
  neutral: "bg-glass text-ink-2",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
};

/** A small status or category label. Colour is never the only signal: the text says it. */
export function Tag({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 font-ui-mono text-label uppercase", TONE[tone], className)}>
      {children}
    </span>
  );
}

/** A count on another element, e.g. unread items. Hidden at zero. */
export function Badge({ count, label, className }: { count: number; label: string; className?: string }) {
  if (count <= 0) return null;
  return (
    <span aria-label={`${count} ${label}`} className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-solid px-1.5 font-ui text-label text-on-solid tabular-nums", className)}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** Counts up to a number once when it appears or changes; instant with reduced motion. */
export function NumberTicker({ value, className, duration = 900 }: { value: number; className?: string; duration?: number }) {
  const [shown, setShown] = useState(() => (computeReduced() ? value : 0));
  const from = useRef(computeReduced() ? value : 0);
  useEffect(() => {
    if (computeReduced() || typeof requestAnimationFrame !== "function") { setShown(value); from.current = value; return; }
    const start = performance.now(), origin = from.current;
    let frame = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / duration);
      const next = Math.round(origin + (value - origin) * (1 - Math.pow(1 - k, 3)));
      setShown(next);
      if (k < 1) frame = requestAnimationFrame(step); else from.current = value;
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);
  return <span className={cn("tabular-nums", className)} aria-label={String(value)}>{shown}</span>;
}

/** Progress from 0 to 1 as a ring, e.g. how much of a study page is filled. */
export function ProgressRing({ value, label, size = 44, className }: { value: number; label: string; size?: number; className?: string }) {
  const clamped = Math.min(1, Math.max(0, value));
  const r = 18, c = 2 * Math.PI * r;
  return (
    <svg
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      width={size}
      height={size}
      viewBox="0 0 44 44"
      className={cn("text-ink", className)}
    >
      <circle cx="22" cy="22" r={r} fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="4" />
      <circle
        cx="22" cy="22" r={r} fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - clamped)} transform="rotate(-90 22 22)"
        className="transition-[stroke-dashoffset] duration-400 ease-out-soft"
      />
    </svg>
  );
}
