import { useEffect, useRef, type CSSProperties } from "react";
import { Mic } from "lucide-react";

/**
 * Press-and-hold to talk, release to send.
 *
 * Pointer Events drive mouse and touch alike; setPointerCapture keeps the
 * release on this element even if the finger drifts. On iPhone that alone was
 * not enough (2026-09-24: "when I hold the button something lags, like it is
 * clicked again and again"):
 * - Safari starts its own long-press gesture (text selection, callout) on a
 *   held button and can cancel the pointer mid-hold;
 * - after release Safari synthesizes a click, which lands on whatever replaced
 *   this button (the Stop button) and cancelled the turn just sent.
 * A non-passive touchstart listener that calls preventDefault stops both, while
 * Pointer Events still fire. React registers touch listeners as passive, so it
 * is attached natively.
 */
export function HoldToTalkButton({
  capturing,
  onStart,
  onFinish,
}: {
  capturing: boolean;
  onStart: () => void;
  onFinish: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  // True while this press holds pointer capture; pointerleave is then noise.
  const capturedRef = useRef(false);
  const pressedRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stop = (e: Event) => { if (e.cancelable) e.preventDefault(); };
    el.addEventListener("touchstart", stop, { passive: false });
    el.addEventListener("touchend", stop, { passive: false });
    return () => {
      el.removeEventListener("touchstart", stop);
      el.removeEventListener("touchend", stop);
    };
  }, []);

  const finish = () => {
    if (!pressedRef.current) return;
    pressedRef.current = false;
    capturedRef.current = false;
    onFinish();
  };

  const style: CSSProperties = {
    touchAction: "none",
    WebkitTouchCallout: "none",
    WebkitUserSelect: "none",
    userSelect: "none",
    WebkitTapHighlightColor: "transparent",
  };

  return (
    <button
      ref={ref}
      type="button"
      aria-label={capturing ? "release to send" : "hold to talk"}
      onPointerDown={(e) => {
        e.preventDefault();
        // A second finger or a repeated down while held is not a new turn.
        if (pressedRef.current) return;
        pressedRef.current = true;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
          capturedRef.current = true;
        } catch { capturedRef.current = false; }
        onStart();
      }}
      onPointerUp={(e) => {
        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* */ }
        finish();
      }}
      onPointerCancel={finish}
      // Only a fallback when capture was unavailable (it keeps events here otherwise).
      onPointerLeave={() => { if (!capturedRef.current) finish(); }}
      onContextMenu={(e) => e.preventDefault()}
      // Held: it grows a little and gains a ring, so a finger covering it still
      // feels the difference; idle it is the solid main control.
      data-capturing={capturing || undefined}
      className="ds-focus grid h-16 w-16 select-none place-items-center rounded-full bg-solid text-on-solid shadow-e2 transition-transform duration-150 active:scale-95 data-[capturing]:scale-110 data-[capturing]:ring-4 data-[capturing]:ring-glass-strong"
      style={style}
    >
      <Mic size={22} aria-hidden="true" />
    </button>
  );
}
