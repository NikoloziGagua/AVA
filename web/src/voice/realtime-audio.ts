// Streams the realtime model's spoken reply (HYBRID mode) to the speakers.
//
// OpenAI sends the audio as a sequence of base64 PCM16 (signed 16-bit LE, mono)
// chunks at 24 kHz via `response.output_audio.delta`. To play them gaplessly we
// decode each chunk to Float32 and schedule it on a shared AudioContext at a
// running "playhead" cursor, so chunk N+1 starts exactly where chunk N ends
// regardless of how bursty the network delivery is.

export const PLAYBACK_SAMPLE_RATE = 24000;

/**
 * Decode a base64 PCM16 (signed 16-bit little-endian, mono) chunk into the
 * Float32 [-1, 1] samples the Web Audio API wants. Pure — unit-tested.
 */
export function pcm16Base64ToFloat32(b64: string): Float32Array {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  // Trailing odd byte (shouldn't happen for PCM16) is ignored.
  const n = len >> 1;
  const view = new DataView(bytes.buffer);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = view.getInt16(i * 2, true);
    out[i] = s < 0 ? s / 0x8000 : s / 0x7fff;
  }
  return out;
}

/**
 * Gapless player for a stream of base64 PCM16 chunks. Lazily creates its own
 * 24 kHz AudioContext on first chunk; `interrupt()` stops playback immediately
 * (barge-in / new turn); `onEnded` fires when the last scheduled chunk finishes.
 */
export class PcmStreamPlayer {
  private ctx: AudioContext | null = null;
  private playhead = 0;
  private readonly sources = new Set<AudioBufferSourceNode>();
  private readonly sampleRate: number;
  /** Called when all scheduled audio has finished playing (queue drained). */
  onEnded: (() => void) | null = null;
  /**
   * Called when a single chunk fails to decode/schedule. The chunk is skipped
   * and playback continues with the rest of the queue — a corrupt delta must not
   * silently cut Ava off mid-sentence. Surfaced so the UI can note a glitch.
   */
  onError: ((err: unknown) => void) | null = null;

  constructor(sampleRate = PLAYBACK_SAMPLE_RATE) {
    this.sampleRate = sampleRate;
  }

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate: this.sampleRate });
      this.playhead = 0;
    }
    return this.ctx;
  }

  /**
   * Decode and schedule a chunk to play after everything queued so far. Chunks
   * are appended at the running playhead, so they always play in arrival order
   * regardless of bursty delivery. A chunk that fails to decode (corrupt base64,
   * a transient audio error) is skipped — `onError` is notified — and the queue
   * keeps draining, so one bad delta can't cut off the rest of the reply.
   */
  enqueue(b64: string): void {
    try {
      const samples = pcm16Base64ToFloat32(b64);
      if (samples.length === 0) return;
      const ctx = this.ensureCtx();
      if (ctx.state === "suspended") void ctx.resume();

      const buffer = ctx.createBuffer(1, samples.length, this.sampleRate);
      buffer.getChannelData(0).set(samples);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);

      const startAt = Math.max(ctx.currentTime, this.playhead);
      src.start(startAt);
      this.playhead = startAt + buffer.duration;

      this.sources.add(src);
      src.onended = () => {
        this.sources.delete(src);
        if (this.sources.size === 0) this.onEnded?.();
      };
    } catch (err) {
      // Skip the bad chunk but keep playing what's already scheduled, and let
      // the next delta resume the stream. Never throw out of the audio path.
      this.onError?.(err);
    }
  }

  /** True while any scheduled chunk is still playing. */
  get playing(): boolean {
    return this.sources.size > 0;
  }

  /** Stop and discard everything currently scheduled (no onEnded fired). */
  interrupt(): void {
    for (const s of this.sources) {
      s.onended = null;
      try { s.stop(); } catch { /* already stopped */ }
      try { s.disconnect(); } catch { /* */ }
    }
    this.sources.clear();
    if (this.ctx) this.playhead = this.ctx.currentTime;
  }

  /** Tear down the AudioContext entirely. */
  close(): void {
    this.interrupt();
    try { void this.ctx?.close(); } catch { /* */ }
    this.ctx = null;
  }
}
