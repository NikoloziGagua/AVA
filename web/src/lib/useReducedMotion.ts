import { useEffect, useState } from "react";
import { computeReduced, MOTION_EVENT } from "./motionPref.js";

/**
 * "Should I skip/soften animations?" — driven by the in-app Motion preference
 * (default: full motion), NOT the raw OS media query, so the owner's explicit
 * choice wins. Re-evaluates on a Motion-pref change AND on an OS-setting change
 * (only relevant while the pref is "system").
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => computeReduced());
  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => setReduced(computeReduced());
    update();
    const mq = typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
    mq?.addEventListener("change", update);
    window.addEventListener(MOTION_EVENT, update);
    return () => {
      mq?.removeEventListener("change", update);
      window.removeEventListener(MOTION_EVENT, update);
    };
  }, []);
  return reduced;
}
