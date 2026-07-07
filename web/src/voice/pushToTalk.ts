// Pure helpers for the push-to-talk key binding. Kept side-effect-free so the
// HOLD semantics can be unit-tested without a DOM / React render.
//
// The gesture is press-AND-HOLD, not press-to-toggle: hold Space (or hold the mic
// button) to talk, release to send. Space is used — not Enter — so a bare Enter
// never both toggles the turn AND re-activates a focused control (the old
// double-dispatch bug), and so Enter stays free for text/normal button activation.

import type { VoiceInputMode } from "./voiceInputMode.js";

/**
 * True if the event target is a text-entry surface (input, textarea, select, or
 * a contenteditable element). We must NOT hijack Enter there — the owner is
 * typing, e.g. in the keyboard chat composer, and Enter should submit/insert as
 * usual rather than toggle the mic.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as (HTMLElement & { isContentEditable?: boolean }) | null;
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

/** True if the key event is the Space bar (the push-to-talk hold key). */
function isSpaceKey(e: { key?: string; code?: string }): boolean {
  return e.key === " " || e.key === "Spacebar" || e.code === "Space";
}

interface HoldKeyEvent {
  key?: string;
  code?: string;
  repeat?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  target?: EventTarget | null;
}

/**
 * Whether a keydown should START a push-to-talk turn (press-and-hold). Only the
 * bare Space bar counts, only in enter_push_to_talk mode, never on auto-repeat
 * (the OS fires repeated keydowns while a key is held — we want exactly one
 * start), never with a modifier, and never while typing in an input/textarea/
 * contenteditable (Space types a space there). The matching keyup ends the turn.
 */
export function shouldStartHold(e: HoldKeyEvent, mode: VoiceInputMode): boolean {
  if (mode !== "enter_push_to_talk") return false;
  if (!isSpaceKey(e)) return false;
  if (e.repeat) return false; // one start per physical press, ignore auto-repeat
  if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return false;
  if (isTypingTarget(e.target ?? null)) return false;
  return true;
}

/**
 * Whether a keyup should FINISH the held turn. The mirror of shouldStartHold, but
 * lenient about repeat/modifiers/target: once a turn is open, ANY Space release
 * should commit it (the release can land on a different target, and finishPtt is a
 * no-op when no turn is in flight, so an unmatched keyup is harmless).
 */
export function shouldFinishHold(e: HoldKeyEvent, mode: VoiceInputMode): boolean {
  if (mode !== "enter_push_to_talk") return false;
  return isSpaceKey(e);
}
