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
  private analyser: AnalyserNode | null = null;
  private analyserData: Float32Array<ArrayBuffer> | null = null;
  private playhead = 0;
  private turnStartTime: number | null = null;
  private turnScheduledEnd = 0;
  private readonly sources = new Set<AudioBufferSourceNode>();
  private readonly sampleRate: number;
  private isHeld = false;
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

  /**
   * Mark the beginning of a new realtime response. This lets the WebSocket
   * client report exactly how much audio was actually heard when it sends
   * conversation.item.truncate during a barge-in.
   */
  beginTurn(): void {
    this.turnStartTime = null;
    this.turnScheduledEnd = 0;
  }

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate: this.sampleRate });
      this.playhead = 0;
      // A parallel measurement tap only. Every source keeps its direct
      // destination connection below, so measurement cannot alter the audible
      // path, its gain, or its latency.
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0;
      this.analyserData = new Float32Array(this.analyser.fftSize);
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
      // A held player stays paused: new chunks queue up behind the pause point.
      if (ctx.state === "suspended" && !this.isHeld) void ctx.resume();

      const buffer = ctx.createBuffer(1, samples.length, this.sampleRate);
      buffer.getChannelData(0).set(samples);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      if (this.analyser) src.connect(this.analyser);

      const startAt = Math.max(ctx.currentTime, this.playhead);
      if (this.turnStartTime == null) this.turnStartTime = startAt;
      src.start(startAt);
      this.playhead = startAt + buffer.duration;
      this.turnScheduledEnd = this.playhead;

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

  /**
   * Pause AVA's audio in place because Sir may be interrupting. Everything
   * scheduled keeps its position, so release() continues mid-word. The player
   * has its own AudioContext, so the microphone is unaffected.
   */
  hold(): void {
    if (!this.ctx || this.isHeld || this.sources.size === 0) return;
    this.isHeld = true;
    void this.ctx.suspend().catch(() => { /* best effort */ });
  }

  /** Resume exactly where hold() paused: the interruption was a false alarm. */
  release(): void {
    if (!this.isHeld) return;
    this.isHeld = false;
    void this.ctx?.resume().catch(() => { /* best effort */ });
  }

  /** True while AVA's audio is paused for a possible interruption. */
  get held(): boolean {
    return this.isHeld;
  }

  /** True while any scheduled chunk is still playing. */
  get playing(): boolean {
    return this.sources.size > 0;
  }

  /** Current bounded RMS of AVA's audible PCM output, for the local face only. */
  get outputLevel(): number {
    if (!this.playing || this.isHeld || !this.analyser || !this.analyserData) return 0;
    try {
      this.analyser.getFloatTimeDomainData(this.analyserData);
      let sum = 0;
      for (const sample of this.analyserData) sum += sample * sample;
      const rms = Math.sqrt(sum / this.analyserData.length);
      return Number.isFinite(rms) ? Math.min(1, Math.max(0, rms)) : 0;
    } catch {
      return 0;
    }
  }

  /** Milliseconds from this response that have reached the speakers. */
  get playedMs(): number {
    if (!this.ctx || this.turnStartTime == null) return 0;
    const heardUntil = Math.min(this.ctx.currentTime, this.turnScheduledEnd);
    return Math.max(0, Math.round((heardUntil - this.turnStartTime) * 1000));
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
    this.turnStartTime = null;
    this.turnScheduledEnd = 0;
    // A confirmed interruption ends any pause; the next reply must be audible.
    if (this.isHeld) {
      this.isHeld = false;
      void this.ctx?.resume().catch(() => { /* best effort */ });
    }
  }

  /** Tear down the AudioContext entirely. */
  close(): void {
    this.interrupt();
    try { this.analyser?.disconnect(); } catch { /* */ }
    this.analyser = null;
    this.analyserData = null;
    try { void this.ctx?.close(); } catch { /* */ }
    this.ctx = null;
  }
}
