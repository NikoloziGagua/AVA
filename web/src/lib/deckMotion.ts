// Shared deck motion system — the single source of every reusable deck
// timeline/helper for the "Liquid Instrument" panels (Chats / Memory / Rules /
// Self). All screens import from here; nothing re-implements eases or durations.
//
// Every helper that animates branches on `reduced` (from useReducedMotion) and
// parks to the final lit state instead of running transforms / loops.
import { gsap, Flip } from "./gsap.js";

/**
 * The deck's signature ease for GSAP tweens — the registered CustomEase "cinematic"
 * (created in lib/gsap.ts from the SVG path of cubic-bezier(0.22,1,0.36,1)). GSAP core
 * can't parse a raw `cubic-bezier(...)` string, so this MUST be the registered name, not
 * the literal curve. The literal CSS curve still lives in theme.css as --ease-cinematic.
 */
export const EASE = "cinematic";

/** The one motion clock for the whole deck. */
export const D = { fast: 0.2, press: 0.12, screen: 0.3, section: 0.5, materialize: 0.6 } as const;

/**
 * ── App-wide SCREEN transition tokens (motion/react) ─────────────────────────
 * One coherent system for every page-to-page swap. Out is faster than in so the
 * outgoing layer clears before the incoming settles; every screen enters and
 * exits identically. The literal CSS curves also live in theme.css
 * (--ease-enter / --ease-exit / --dur-enter / --dur-exit / --dur-orb).
 */
export const SCREEN = {
  enter: 0.34, // --dur-enter
  exit: 0.22, // --dur-exit (out faster than in)
  orb: 0.44, // --dur-orb — the shared-orb Flip
  /** Panel content cascade waits this long so container wash-in and the stagger
   *  are sequential, never stacked. */
  contentDelay: 0.12,
  easeEnter: [0.22, 1, 0.36, 1] as [number, number, number, number],
  easeExit: [0.4, 0, 0.2, 1] as [number, number, number, number],
  /** Identical entry/exit states for EVERY screen. */
  from: { opacity: 0, y: 8, scale: 0.99 },
  to: { opacity: 1, y: 0, scale: 1 },
  exitTo: { opacity: 0, scale: 1.01 },
} as const;

/**
 * ── GL transition gate ───────────────────────────────────────────────────────
 * The always-on WebGL loops (DottedSurface / NeuralField / MemoryBrain) idle
 * while a page transition is mid-flight. During the concurrent AnimatePresence
 * overlap the OUTGOING screen keeps rendering its GL under the opaque incoming
 * screen while a fresh context builds — several rAF loops + a synchronous build
 * in the same frames is exactly when the frame budget blows. App marks the
 * window (markTransition); the loops short-circuit their tick until it passes.
 */
let _transitionUntil = 0;
export function markTransition(durationMs: number): void {
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  _transitionUntil = Math.max(_transitionUntil, now + durationMs);
}
export function glPaused(): boolean {
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  return now < _transitionUntil;
}

/** Card resting + hover/lift shadow strings (so hover handlers and CSS agree). */
export const SHADOW = {
  rest: "0 1px 0 0 rgba(255,255,255,.07) inset, 0 0 0 1px rgba(92,242,255,.04) inset, 0 24px 60px -24px rgba(0,0,0,.8)",
  hover: "0 1px 0 0 rgba(255,255,255,.10) inset, 0 0 0 1px rgba(92,242,255,.14) inset, 0 30px 70px -28px rgba(0,0,0,.85), 0 0 26px -6px rgba(92,242,255,.18)",
};

/**
 * The panel-enter master timeline. Scoped via useGSAP({ scope }) so its selector
 * strings resolve inside the PanelShell root. Returns the timeline.
 *
 * Steps (all on --ease-cinematic unless noted):
 *   1. [data-panel-stage]      materialize: opacity 0→1, scale .97→1, y 8→0, blur 10→0px (D.materialize)
 *   2. [data-panel-bloom]      glow bloom in (scale 1.12→1, power2.out)
 *   3. [data-panel-titlewrap]  specular sweep across the title rail (--sweep-x -120%→120%)
 *   4. [data-title-rule]       DrawSVG the mercury underline out from center
 *   5. [data-panel-title]      ScrambleText decode into `title` (if present)
 *   6. [data-panel-section]    stagger up (y 22→0, opacity 0→1)
 *   7. [data-panel-section]    per-section specular sweep (--sweep-x -130%→130%)
 */
export function buildPanelEnter(_root: HTMLElement, _title: string): gsap.core.Timeline {
  // Lead-in: hold the content cascade for ~120ms so the App container's opacity
  // wash-in finishes first, then the sections cascade — sequential, not stacked
  // (both starting at t=0 read as a muddy double-move).
  const tl = gsap.timeline({ delay: SCREEN.contentDelay, defaults: { ease: EASE } });
  // Calm open. The owner disliked the title "glow + glitch" on every open, so the
  // ScrambleText decode and the titlewrap specular sweep are both gone — the title
  // simply fades up and its mercury underline draws out. (No [data-panel-stage]
  // materialize either: the panel root already covers the screen opaque, and the
  // section stagger carries the content in; a stage-wide blur-fade read as a flash.)
  tl.fromTo("[data-panel-bloom]",
    { opacity: 0, scale: 1.08 }, { opacity: 1, scale: 1, duration: 0.7, ease: "power2.out" }, 0.04);
  tl.from("[data-panel-title]", { y: 10, opacity: 0, duration: 0.5, ease: "power2.out" }, 0.06);
  tl.from("[data-title-rule]", { drawSVG: "50% 50%", duration: 0.6, ease: "power2.out" }, 0.16);
  tl.from("[data-panel-section]",
    { y: 22, opacity: 0, duration: D.section, stagger: 0.07, clearProps: "transform,opacity" }, 0.22);
  return tl;
}

/** Reduced-motion: jump to the final, lit state. No transforms, no scramble, no loops. */
export function setPanelStatic(root: HTMLElement, title: string): void {
  gsap.set("[data-panel-stage]", { opacity: 1, scale: 1, y: 0, filter: "none", clearProps: "filter,transform" });
  gsap.set("[data-panel-bloom]", { opacity: 1, scale: 1 });
  gsap.set("[data-panel-section]", { opacity: 1, y: 0, clearProps: "transform,opacity" });
  const t = root.querySelector<HTMLElement>("[data-panel-title]");
  if (t) t.textContent = title;
}

/**
 * Pointer hover-lift for any .lg-slab card. Call from contextSafe handlers (so
 * GSAP cleans up on unmount); no-op when reduced. Lifts the card, swaps to the
 * brighter shadow, and glints the specular sweep across once on enter.
 */
export function hoverLift(el: HTMLElement, on: boolean, reduced: boolean): void {
  if (reduced) return;
  gsap.to(el, on
    ? { y: -3, boxShadow: SHADOW.hover, duration: D.fast, ease: "power2.out" }
    : { y: 0, boxShadow: SHADOW.rest, duration: D.screen, ease: "power3.out" });
  gsap.fromTo(el, { "--sweep-x": "-130%" }, { "--sweep-x": on ? "130%" : "-130%", duration: on ? 0.7 : 0, ease: "power2.inOut" });
}

/** Press feedback for any button. reduced → no-op. */
export function press(el: HTMLElement, down: boolean, reduced: boolean): void {
  if (reduced) return;
  gsap.to(el, down ? { scale: 0.96, duration: D.press, ease: "power2.in" } : { scale: 1, duration: D.fast, ease: "power3.out" });
}

/** Settle a numeric/label via ScrambleText (counts, timestamps). reduced → set text directly. */
export function settleText(el: HTMLElement, text: string, reduced: boolean, chars: "upperCase" | "0123456789" = "0123456789"): void {
  if (reduced) { el.textContent = text; return; }
  gsap.to(el, { duration: 0.6, scrambleText: { text, chars, speed: 0.7, revealDelay: 0.1 } });
}

/**
 * Run a GSAP Flip reorder around a DOM mutation. `getState` snapshots the laid-out
 * elements, `mutate` performs the React-driven DOM change, then Flip.from animates.
 *
 * NOTE: in React the mutation goes through state and commits asynchronously, so for
 * list reorders/deletes you usually snapshot in the handler and call Flip.from in a
 * useGSAP layout-effect keyed on the list (see ChatListScreen pattern). This helper
 * is for the synchronous case (e.g. an imperative DOM toggle).
 */
export function flipReorder(
  getState: () => Flip.FlipState,
  mutate: () => void,
  reduced: boolean,
  vars: Flip.FromToVars = { duration: 0.5, ease: "power2.inOut", absolute: true, stagger: 0.04 },
): void {
  if (reduced) { mutate(); return; }
  const state = getState();
  mutate();
  Flip.from(state, vars);
}
