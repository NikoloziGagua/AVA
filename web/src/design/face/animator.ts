/**
 * The face's behaviour, independent of rendering: natural blinking, small
 * glances, following the pointer, and a pose per state. Values move on
 * damped springs so nothing snaps. While speaking, the jaw follows `level`
 * (AVA's real voice energy from voice/faceSignal in phase D) or, without
 * one, a gentle simulated speech rhythm.
 */

export type FaceMode = "idle" | "listening" | "thinking" | "speaking";
type Key = "blink" | "open" | "smile" | "brow" | "gx" | "gy" | "yaw" | "pitch" | "roll" | "think" | "energy";

export class FaceAnimator {
  readonly state: Record<Key, number> = { blink: 0, open: 0, smile: 0.12, brow: 0, gx: 0, gy: 0, yaw: 0, pitch: 0, roll: 0, think: 0, energy: 0.1 };
  private readonly velocity: Record<Key, number> = { blink: 0, open: 0, smile: 0, brow: 0, gx: 0, gy: 0, yaw: 0, pitch: 0, roll: 0, think: 0, energy: 0 };
  mode: FaceMode = "idle";
  /** Pointer in face-canvas clip space (-1..1), or null when away. */
  pointer: [number, number] | null = null;
  /** Live voice energy 0..1 while speaking; null uses the simulated rhythm. */
  level: number | null = null;
  private nextBlink = 1.2;
  private blinkStart = -1;
  private doubleBlink = false;
  private nextGlance = 0.5;
  private glance: [number, number] = [0, 0];
  private override = { smile: 0, brow: 0, until: 0 };

  constructor(private readonly random: () => number = Math.random) {}

  trigger(action: "blink" | "smile" | "brows", now: number): void {
    if (action === "blink") { this.blinkStart = now; this.doubleBlink = false; }
    if (action === "smile") this.override = { smile: 0.95, brow: 0.1, until: now + 2.2 };
    if (action === "brows") this.override = { smile: 0.2, brow: 1, until: now + 1.6 };
  }

  private spring(key: Key, target: number, dt: number, stiffness: number, damping: number): void {
    const accel = (target - this.state[key]) * stiffness - this.velocity[key] * damping;
    this.velocity[key] += accel * dt;
    this.state[key] += this.velocity[key] * dt;
  }

  private speech(t: number): number {
    // Phrases of 1.6–4.2 s with short pauses, syllables around 4 Hz.
    const phrase = (Math.sin(t * 0.9) + Math.sin(t * 0.37 + 1.3)) > -0.6;
    if (!phrase) return 0;
    const syllable = Math.max(0, Math.sin(t * 2 * Math.PI * 4.1 + Math.sin(t * 2.3) * 1.8));
    return Math.pow(syllable, 0.7) * (0.55 + 0.45 * Math.sin(t * 1.3 + 1.2) ** 2);
  }

  step(t: number, dt: number): void {
    // Blinks every 2.2–6 s, sometimes twice.
    if (this.blinkStart < 0 && t > this.nextBlink) { this.blinkStart = t; this.doubleBlink = this.random() < 0.18; }
    let blink = 0;
    if (this.blinkStart >= 0) {
      const b = t - this.blinkStart;
      const one = (x: number) => (x < 0.07 ? Math.max(0, x) / 0.07 : x < 0.18 ? 1 - (x - 0.07) / 0.11 : 0);
      blink = one(b) + (this.doubleBlink ? one(b - 0.24) : 0);
      if (b > (this.doubleBlink ? 0.45 : 0.2)) { this.blinkStart = -1; this.nextBlink = t + 2.2 + this.random() * 3.8; }
    }
    this.state.blink = Math.min(1, blink);

    if (t > this.nextGlance) {
      this.glance = [(this.random() - 0.5) * 0.7, (this.random() - 0.5) * 0.4];
      this.nextGlance = t + 0.6 + this.random() * 1.8;
    }
    let gx = this.glance[0] * 0.5, gy = this.glance[1] * 0.5;
    let yaw = Math.sin(t * 0.31) * 0.05, pitch = Math.sin(t * 0.23) * 0.025, roll = 0;
    let smile = 0.12, brow = 0, open = 0, think = 0, energy = 0.1;
    if (this.pointer) { gx = this.pointer[0] * 0.9; gy = this.pointer[1] * 0.8; yaw = this.pointer[0] * 0.22; pitch = -this.pointer[1] * 0.12; }
    if (this.mode === "listening") { brow = 0.35; smile = 0.25; pitch += 0.03; if (!this.pointer) { gx *= 0.4; gy *= 0.4; } energy = 0.25; }
    if (this.mode === "thinking") { gx = -0.75; gy = 0.8; yaw = -0.14; pitch = -0.05; roll = 0.05; brow = 0.2; smile = 0.02; think = 1; energy = 0.2; }
    if (this.mode === "speaking") {
      const env = this.level ?? this.speech(t);
      open = env; energy = 0.35 + env * 0.65;
      smile = 0.28 + (env < 0.05 ? 0.12 : 0); brow = 0.15 + env * 0.25; pitch += env * 0.035; yaw += Math.sin(t * 0.8) * 0.05;
    }
    if (t < this.override.until) { smile = Math.max(smile, this.override.smile); brow = Math.max(brow, this.override.brow); }

    this.spring("gx", gx, dt, 160, 22); this.spring("gy", gy, dt, 160, 22);
    this.spring("yaw", yaw, dt, 40, 13); this.spring("pitch", pitch, dt, 40, 13); this.spring("roll", roll, dt, 30, 12);
    this.spring("smile", smile, dt, 50, 14); this.spring("brow", brow, dt, 70, 16);
    this.spring("open", open, dt, 420, 34); this.spring("think", think, dt, 20, 9); this.spring("energy", energy, dt, 60, 16);
  }
}
