// Pure helpers for the Enter push-to-talk key binding. Kept side-effect-free so
// the toggle semantics can be unit-tested without a DOM / React render.

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

/**
 * Whether a keydown should toggle the push-to-talk turn. Only the bare Enter key
 * counts, only in enter_push_to_talk mode, never on auto-repeat (holding the
 * key), and never while typing in an input. Modifier+Enter is ignored so it
 * doesn't collide with other shortcuts.
 */
export function shouldToggleOnEnter(
  e: { key: string; repeat?: boolean; shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; target?: EventTarget | null },
  mode: VoiceInputMode,
): boolean {
  if (mode !== "enter_push_to_talk") return false;
  if (e.key !== "Enter") return false;
  if (e.repeat) return false; // ignore key-repeat from a held Enter
  if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return false;
  if (isTypingTarget(e.target ?? null)) return false;
  return true;
}
