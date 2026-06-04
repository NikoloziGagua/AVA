// Pure mapping from Ava's state to the Orb's motion parameters. Kept separate
// from the component so it's unit-testable and the same numbers drive GSAP.

export type OrbState = "idle" | "listening" | "thinking" | "responding" | "working";

export interface OrbMotion {
  /** Rotation period in seconds — HIGHER = slower spin. */
  spin: number;
  /** Border-radius morph period in seconds — HIGHER = calmer. */
  morph: number;
  /** Cyan rim opacity 0..1 (listening also scales with amplitude). */
  rimOpacity: number;
}

export function orbMotion(state: OrbState, amplitude = 0): OrbMotion {
  const amp = Math.max(0, Math.min(1, amplitude));
  switch (state) {
    case "listening":  return { spin: 16, morph: 7,   rimOpacity: 0.5 + amp * 0.5 };
    case "thinking":   return { spin: 6,  morph: 3,   rimOpacity: 0.8 };
    case "working":    return { spin: 5,  morph: 3,   rimOpacity: 0.85 };
    case "responding": return { spin: 7,  morph: 3.5, rimOpacity: 1 };
    default:           return { spin: 18, morph: 7,   rimOpacity: 0.55 };
  }
}
