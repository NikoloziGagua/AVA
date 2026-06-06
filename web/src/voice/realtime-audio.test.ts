import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { pcm16Base64ToFloat32, PcmStreamPlayer } from "./realtime-audio.js";

// Encode signed-16-bit-LE samples to base64 the way the realtime API does, so we
// can assert the decode is exact.
function pcm16ToBase64(samples: number[]): string {
  const buf = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buf);
  samples.forEach((s, i) => view.setInt16(i * 2, s, true));
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

describe("pcm16Base64ToFloat32", () => {
  it("decodes silence to zeros", () => {
    const out = pcm16Base64ToFloat32(pcm16ToBase64([0, 0, 0]));
    expect(Array.from(out)).toEqual([0, 0, 0]);
  });

  it("maps full-scale +/- to ~+/-1.0", () => {
    const out = pcm16Base64ToFloat32(pcm16ToBase64([32767, -32768]));
    expect(out[0]).toBeCloseTo(1, 4);
    expect(out[1]).toBeCloseTo(-1, 4);
  });

  it("is little-endian (low byte first)", () => {
    // 0x0100 LE = 256
    const out = pcm16Base64ToFloat32(pcm16ToBase64([256]));
    expect(out[0]).toBeCloseTo(256 / 0x7fff, 6);
  });

  it("returns an empty array for an empty chunk", () => {
    expect(pcm16Base64ToFloat32("").length).toBe(0);
  });
});

// ─── PcmStreamPlayer queue continuity + decode-drop recovery ─────────────────
// A minimal AudioContext fake that records the scheduled start time of every
// buffer source, so we can prove chunks play in order (back-to-back at the
// running playhead) and that a corrupt chunk is skipped without cutting off the
// rest of the queue.
class FakeSource {
  buffer: { duration: number } | null = null;
  onended: (() => void) | null = null;
  stopped = 0;
  disconnected = 0;
  start(t: number) { startTimes.push(t); }
  stop() { this.stopped++; }
  connect() {}
  disconnect() { this.disconnected++; }
}
let startTimes: number[] = [];
let created: FakeSource[] = [];
class FakeAudioContext {
  currentTime = 0;
  state = "running";
  get destination() { return {}; }
  createBuffer(_ch: number, len: number, rate: number) {
    return { duration: len / rate, getChannelData: () => new Float32Array(len) };
  }
  createBufferSource() { const s = new FakeSource(); created.push(s); return s as unknown as AudioBufferSourceNode; }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
}

function pcm16Chunk(sampleCount: number): string {
  const buf = new ArrayBuffer(sampleCount * 2);
  const view = new DataView(buf);
  for (let i = 0; i < sampleCount; i++) view.setInt16(i * 2, 100, true);
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

describe("PcmStreamPlayer", () => {
  beforeEach(() => {
    startTimes = [];
    created = [];
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  });
  afterEach(() => {
    delete (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
  });

  it("schedules chunks in order, back-to-back at the running playhead", () => {
    const p = new PcmStreamPlayer(24000);
    p.enqueue(pcm16Chunk(2400));  // 0.1s
    p.enqueue(pcm16Chunk(2400));  // 0.1s
    p.enqueue(pcm16Chunk(2400));  // 0.1s
    expect(created.length).toBe(3);
    // start times are monotonic and spaced by each chunk's duration (0.1s).
    expect(startTimes[0]).toBeCloseTo(0, 5);
    expect(startTimes[1]).toBeCloseTo(0.1, 5);
    expect(startTimes[2]).toBeCloseTo(0.2, 5);
  });

  it("skips a corrupt chunk (onError) and keeps draining the rest — no cut-off", () => {
    const p = new PcmStreamPlayer(24000);
    const errs: unknown[] = [];
    p.onError = (e) => errs.push(e);
    p.enqueue(pcm16Chunk(2400));       // ok
    p.enqueue("!!! not valid base64"); // throws inside enqueue → skipped
    p.enqueue(pcm16Chunk(2400));       // ok — stream continues
    expect(errs.length).toBe(1);
    expect(created.length).toBe(2);    // only the two valid chunks scheduled
    // The second valid chunk still lines up right after the first (continuity).
    expect(startTimes[1]).toBeCloseTo(0.1, 5);
  });

  it("fires onEnded only when the last scheduled source finishes", () => {
    const p = new PcmStreamPlayer(24000);
    const ended = vi.fn();
    p.onEnded = ended;
    p.enqueue(pcm16Chunk(2400));
    p.enqueue(pcm16Chunk(2400));
    expect(ended).not.toHaveBeenCalled();
    created[0]!.onended?.();  // first finishes — queue not yet empty
    expect(ended).not.toHaveBeenCalled();
    created[1]!.onended?.();  // last finishes — drained
    expect(ended).toHaveBeenCalledTimes(1);
  });
});

// ─── PcmStreamPlayer.interrupt() — barge-in cuts the model's audio ────────────
// interrupt() must (a) stop + disconnect every still-scheduled source so the
// speakers go quiet immediately, (b) reset the playhead so the NEXT enqueue
// starts at the live cursor (no overlap with the audio we just killed), and
// (c) be a safe no-op when nothing is playing. These are the barge-in guarantees
// the voice hook relies on (useRealtimeVoice interrupt() → player.interrupt()).
describe("PcmStreamPlayer.interrupt()", () => {
  beforeEach(() => {
    startTimes = [];
    created = [];
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  });
  afterEach(() => {
    delete (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
  });

  it("stops and disconnects every active source without throwing", () => {
    const p = new PcmStreamPlayer(24000);
    p.enqueue(pcm16Chunk(2400));
    p.enqueue(pcm16Chunk(2400));
    p.enqueue(pcm16Chunk(2400));
    expect(p.playing).toBe(true);
    expect(() => p.interrupt()).not.toThrow();
    // Each scheduled source was stopped + disconnected exactly once.
    for (const s of created) {
      expect(s.stopped).toBe(1);
      expect(s.disconnected).toBe(1);
    }
    // Nothing is playing anymore — the source set was cleared.
    expect(p.playing).toBe(false);
  });

  it("does not fire onEnded for the killed sources (barge-in is not a clean drain)", () => {
    const p = new PcmStreamPlayer(24000);
    const ended = vi.fn();
    p.onEnded = ended;
    p.enqueue(pcm16Chunk(2400));
    p.enqueue(pcm16Chunk(2400));
    p.interrupt();
    expect(ended).not.toHaveBeenCalled();
    // interrupt() detaches onended, so even a late callback from the audio layer
    // can't resurrect the drained-callback after a barge-in.
    expect(created[0]!.onended).toBeNull();
    expect(created[1]!.onended).toBeNull();
  });

  it("resets scheduling so a subsequent enqueue starts fresh at the live playhead (no overlap)", () => {
    const ctx = new FakeAudioContext();
    // Pin a single shared context so we can advance currentTime like a real clock.
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = function () { return ctx; } as unknown;

    const p = new PcmStreamPlayer(24000);
    p.enqueue(pcm16Chunk(2400)); // 0.1s → playhead now 0.1
    p.enqueue(pcm16Chunk(2400)); // 0.2s → playhead now 0.2
    expect(startTimes).toEqual([0, 0.1]);

    // The owner barges in 0.05s into playback. interrupt() should rebase the
    // playhead to the live currentTime (0.05), NOT leave it at the old 0.2 — else
    // the next clip would be scheduled in the future, overlapping dead audio.
    ctx.currentTime = 0.05;
    p.interrupt();

    p.enqueue(pcm16Chunk(2400)); // fresh turn
    // The new clip starts at the live cursor (0.05), proving the stale 0.2
    // playhead was discarded.
    expect(startTimes[2]).toBeCloseTo(0.05, 5);
    expect(p.playing).toBe(true);
  });

  it("is safe to call when nothing has ever played (no context yet)", () => {
    const p = new PcmStreamPlayer(24000);
    expect(p.playing).toBe(false);
    expect(() => p.interrupt()).not.toThrow();
    expect(p.playing).toBe(false);
  });

  it("is safe to call twice in a row (idempotent)", () => {
    const p = new PcmStreamPlayer(24000);
    p.enqueue(pcm16Chunk(2400));
    p.interrupt();
    expect(() => p.interrupt()).not.toThrow();
    expect(p.playing).toBe(false);
  });
});
