// One-shot pointer/viewport probes for copy + layout decisions ("tap" vs
// "press Space", overlay vs docked panel). jsdom has no matchMedia — treat that
// as a fine-pointer desktop (the test environment) instead of throwing.

/** Coarse pointer (touch) — phones/tablets, where there's no spacebar/hover. */
export function isCoarsePointer(): boolean {
  try {
    return window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

/** Below Tailwind's `sm` breakpoint (640px) — the phone layout. */
export function isSmallScreen(): boolean {
  try {
    return window.matchMedia("(max-width: 639px)").matches;
  } catch {
    return false;
  }
}
