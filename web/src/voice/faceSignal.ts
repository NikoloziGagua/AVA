/**
 * Ephemeral, renderer-neutral bridge between AVA's voice engines and her face.
 *
 * Mode changes are rare and subscribable. Audio levels are deliberately polled
 * by the renderer instead of notifying React at audio rate. A writer claim is
 * epoch-scoped so a retiring engine cannot overwrite its successor.
 */

export type FaceSignalMode = "idle" | "listening" | "thinking" | "speaking";
export type FaceOutputSource = "measured" | "synthetic" | "none";

export type FaceLevelSample = {
  input: number;
  output: number;
  outputSource: FaceOutputSource;
};

export type FaceSignalWriter = {
  setMode(mode: FaceSignalMode): void;
  publishInput(level: number, now?: number): void;
  setOutputSource(source: "measured", sampler: () => number): void;
  setOutputSource(source: "synthetic" | "none"): void;
  reset(): void;
  release(): void;
};

const INPUT_STALE_MS = 250;

let epoch = 0;
let mode: FaceSignalMode = "idle";
let input = 0;
let inputAt = Number.NEGATIVE_INFINITY;
let outputSource: FaceOutputSource = "none";
let outputSampler: (() => number) | null = null;
const modeListeners = new Set<() => void>();

function clockNow(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function bounded(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function updateMode(next: FaceSignalMode): void {
  if (next === mode) return;
  mode = next;
  for (const listener of [...modeListeners]) listener();
}

function clearSignal(nextMode: FaceSignalMode): void {
  input = 0;
  inputAt = Number.NEGATIVE_INFINITY;
  outputSource = "none";
  outputSampler = null;
  updateMode(nextMode);
}

export function getFaceSignalMode(): FaceSignalMode {
  return mode;
}

export function subscribeFaceSignalMode(listener: () => void): () => void {
  modeListeners.add(listener);
  return () => { modeListeners.delete(listener); };
}

export function sampleFaceSignalLevels(now = clockNow()): FaceLevelSample {
  const inputAge = now - inputAt;
  const liveInput = inputAge >= 0 && inputAge <= INPUT_STALE_MS ? input : 0;
  let output = 0;
  if (outputSource === "measured" && outputSampler) {
    try { output = bounded(outputSampler()); } catch { output = 0; }
  }
  return { input: liveInput, output, outputSource };
}

export function claimFaceSignalWriter(_engineId: string): FaceSignalWriter {
  const writerEpoch = ++epoch;
  clearSignal("idle");
  const current = () => writerEpoch === epoch;

  return {
    setMode(next) {
      if (current()) updateMode(next);
    },
    publishInput(level, now = clockNow()) {
      if (!current()) return;
      input = bounded(level);
      inputAt = now;
    },
    setOutputSource(source: "measured" | "synthetic" | "none", sampler?: () => number) {
      if (!current()) return;
      outputSource = source;
      outputSampler = source === "measured" && typeof sampler === "function" ? sampler : null;
    },
    reset() {
      if (current()) clearSignal("idle");
    },
    release() {
      if (!current()) return;
      clearSignal("idle");
      epoch += 1;
    },
  } as FaceSignalWriter;
}

/** Tests only. Production code owns state through claim/release. */
export function resetFaceSignalForTests(): void {
  epoch += 1;
  modeListeners.clear();
  clearSignal("idle");
}
