// @vitest-environment jsdom
//
// EFFECTFUL (stateful glue) tests for the voice hook — the part that the pure
// decision-function tests (voiceInputMode/pushToTalk/realtime-events) can't
// reach and where voice regressions have actually slipped through: barge-in
// (cutting Ava off mid-reply) and HYBRID turn-taking (mic stays closed while she
// works/speaks). These drive the REAL hook through `renderHook`, faking only the
// network/audio boundaries (WebSocket, Audio, fetch, AudioContext, getUserMedia)
// so nothing touches the speakers, the network, or a real clock.
//
// Determinism: the only path under test resolves on the microtask queue (mocked
// fetch/blob/play all resolve synchronously). We never await a real timer; the
// settle/fallback/reconnect timers are driven by vitest fake timers so a test
// can't hang on the 350ms / 4000ms / 800ms timeouts.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

// ── Module boundaries ────────────────────────────────────────────────────────
// Mock the API client so interrupt()'s `api.kill` and any agent send are inert
// (no real fetch, resolved promises). Keep the named approval helpers as no-ops.
const killSpy = vi.fn((..._a: unknown[]) => Promise.resolve({ aborted: true }));
const sendSpy = vi.fn((..._a: unknown[]) => Promise.resolve({ sessionId: "srv-session" }));
vi.mock("../api.js", () => ({
  api: {
    kill: (...a: unknown[]) => killSpy(...a),
    sendMessage: (...a: unknown[]) => sendSpy(...a),
  },
  approveApproval: vi.fn(() => Promise.resolve()),
  denyApproval: vi.fn(() => Promise.resolve()),
}));
// Stable token so the speak fetch has an auth header without touching storage.
vi.mock("../auth/tokens.js", () => ({ getToken: () => "tkn" }));

import { useRealtimeVoice } from "./useRealtimeVoice.js";

// ── Fakes ────────────────────────────────────────────────────────────────────

// Controllable WebSocket: records sends, lets the test emit open/message/close.
class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  static last: FakeWebSocket | null = null;

  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  private listeners: Record<string, ((ev: unknown) => void)[]> = {};

  constructor(public url: string) {
    FakeWebSocket.last = this;
  }
  addEventListener(type: string, fn: (ev: unknown) => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  removeEventListener(type: string, fn: (ev: unknown) => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn);
  }
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = FakeWebSocket.CLOSED; }

  private emit(type: string, ev: unknown) {
    for (const fn of this.listeners[type] ?? []) fn(ev);
  }
  fireOpen() { this.readyState = FakeWebSocket.OPEN; this.emit("open", {}); }
  fireMessage(obj: unknown) { this.emit("message", { data: JSON.stringify(obj) }); }
  fireClose(init: { code?: number; reason?: string; wasClean?: boolean } = {}) {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", { code: init.code ?? 1000, reason: init.reason ?? "", wasClean: init.wasClean ?? true });
  }
  /** Did we forward a captured mic chunk upstream? (echo-guard probe.) */
  get appendCount() {
    return this.sent.filter((s) => s.includes("input_audio_buffer.append")).length;
  }
}

// Fake <audio> for the TTS clips. play() resolves; the clip's await only ends
// when onended/onerror fires OR interrupt() calls the captured `done`.
class FakeAudio {
  static created: FakeAudio[] = [];
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  paused = 0;
  played = 0;
  constructor(public src?: string) { FakeAudio.created.push(this); }
  play() { this.played++; return Promise.resolve(); }
  pause() { this.paused++; }
}

// One AudioContext fake serving BOTH the mic-capture pipeline (resume/
// audioWorklet/createMediaStreamSource) and the PcmStreamPlayer (createBuffer/
// createBufferSource/currentTime/destination).
class FakeBufferSource {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  start() {}
  stop() {}
  connect() {}
  disconnect() {}
}
class FakeAudioContext {
  static created: FakeAudioContext[] = [];
  currentTime = 0;
  state = "running";
  audioWorklet = { addModule: vi.fn(async () => {}) };
  constructor(_opts?: unknown) { FakeAudioContext.created.push(this); }
  get destination() { return {}; }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
  createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
  createBuffer(_ch: number, len: number, rate: number) {
    return { duration: len / rate, getChannelData: () => new Float32Array(len) };
  }
  createBufferSource() { return new FakeBufferSource() as unknown as AudioBufferSourceNode; }
}

// Worklet node: capture its port so the test can simulate a mic frame arriving.
class FakeAudioWorkletNode {
  static last: FakeAudioWorkletNode | null = null;
  port = {
    onmessage: null as ((ev: { data: ArrayBuffer }) => void) | null,
    close: vi.fn(),
  };
  constructor() { FakeAudioWorkletNode.last = this; }
  connect() {}
  disconnect() {}
}

function fakeMediaStream() {
  const track = { enabled: true, stop: vi.fn() };
  return {
    _track: track,
    getAudioTracks: () => [track],
    getTracks: () => [track],
  };
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  FakeWebSocket.last = null;
  FakeAudio.created = [];
  FakeAudioContext.created = [];
  FakeAudioWorkletNode.last = null;
  killSpy.mockClear();
  sendSpy.mockClear();

  const g = globalThis as Record<string, unknown>;
  g.WebSocket = FakeWebSocket as unknown;
  g.Audio = FakeAudio as unknown;
  g.AudioContext = FakeAudioContext as unknown;
  g.AudioWorkletNode = FakeAudioWorkletNode as unknown;

  // /api/speak → a playable blob; anything else → empty ok (not exercised here).
  fetchSpy = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes("/api/speak")) {
      return { ok: true, blob: async () => new Blob(["x"], { type: "audio/mpeg" }) } as unknown as Response;
    }
    return { ok: true, blob: async () => new Blob([]), text: async () => "{}", json: async () => ({}) } as unknown as Response;
  });
  g.fetch = fetchSpy as unknown;

  // Stub object-URL helpers (jsdom doesn't implement createObjectURL).
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => "blob:fake");
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();

  // getUserMedia → a controllable fake stream.
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => fakeMediaStream() as unknown as MediaStream) },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear(); // don't leak the PTT mode into the vad-default tests
});

// Let queued microtasks (the speak worker's fetch→blob→play chain, start()'s
// getUserMedia + worklet awaits) settle. Several ticks because the chain is a few
// awaits deep; no real timer is involved so this stays deterministic.
async function flush(times = 6) {
  for (let i = 0; i < times; i++) {
    await act(async () => { await Promise.resolve(); });
  }
}

// Bring a hybrid session fully online: open the socket and latch hybrid mode via
// the session hello, leaving the hook in "listening".
async function bootHybrid() {
  const hook = renderHook(() => useRealtimeVoice({ initialSessionId: "s0" }));
  await act(async () => { hook.result.current.start(); });
  await flush();
  const ws = FakeWebSocket.last!;
  await act(async () => { ws.fireOpen(); });
  await flush();
  // Session hello in HYBRID mode — latches the model-speaks path.
  await act(async () => { ws.fireMessage({ type: "ava.session", sessionId: "s0", mode: "hybrid" }); });
  return { hook, ws };
}

// Bring a session online already in enter_push_to_talk mode (read from storage at
// mount). Lands in "listening" with the mic SUSPENDED between turns.
async function bootPtt() {
  localStorage.setItem("ava.voiceInputMode", "enter_push_to_talk");
  const hook = renderHook(() => useRealtimeVoice({ initialSessionId: "s0" }));
  await act(async () => { hook.result.current.start(); });
  await flush();
  const ws = FakeWebSocket.last!;
  await act(async () => { ws.fireOpen(); });
  await flush();
  return { hook, ws };
}

describe("useRealtimeVoice — hybrid turn-taking (effectful)", () => {
  it("connects, latches hybrid, and lands in listening", async () => {
    const { hook } = await bootHybrid();
    expect(hook.result.current.state).toBe("listening");
  });

  it("ava.step → captions the step, speaks it (fetch /api/speak), and holds the mic closed", async () => {
    const { hook, ws } = await bootHybrid();
    const node = FakeAudioWorkletNode.last!;

    // Positive control: while listening (vad, unmuted), a mic frame IS forwarded.
    // This proves the echo-guard probe below isn't vacuously "never appends".
    expect(hook.result.current.state).toBe("listening");
    act(() => { node.port.onmessage?.({ data: new ArrayBuffer(256) }); });
    expect(ws.appendCount).toBe(1);

    await act(async () => {
      ws.fireMessage({ type: "ava.step", tool: "chrome_navigate", args: { url: "https://bing.com" } });
    });
    await flush();

    // Caption narrates the step (humanizeTool: chrome_navigate → "Opening bing.com").
    expect(hook.result.current.caption).toEqual({ who: "ava", text: "Opening bing.com" });
    // The step phrase was sent to TTS.
    expect(fetchSpy.mock.calls.some(([u]) => String(u).includes("/api/speak"))).toBe(true);
    // While a step is in flight the hook is NOT "listening" → mic is gated.
    expect(hook.result.current.state).not.toBe("listening");

    // Echo guard: a mic frame arriving NOW must NOT be forwarded upstream
    // (shouldForwardMic is false unless state === "listening") — so Ava's own
    // narration can't be re-heard and transcribed into a phantom turn.
    const before = ws.appendCount;
    act(() => { node.port.onmessage?.({ data: new ArrayBuffer(256) }); });
    expect(ws.appendCount).toBe(before); // stayed closed between steps
  });

  it("ava.result → speaks the result so the turn can drain (queues a /api/speak clip)", async () => {
    const { ws } = await bootHybrid();
    fetchSpy.mockClear();

    await act(async () => { ws.fireMessage({ type: "ava.result", text: "Opened it, Sir." }); });
    await flush();

    expect(fetchSpy.mock.calls.some(([u]) => String(u).includes("/api/speak"))).toBe(true);
    // The clip that was created plays the result.
    expect(FakeAudio.created.length).toBeGreaterThan(0);
  });

  it("an EMPTY result still enqueues a clip (else hands-free hangs after a task)", async () => {
    const { ws } = await bootHybrid();
    fetchSpy.mockClear();

    await act(async () => { ws.fireMessage({ type: "ava.result", text: "   " }); });
    await flush();

    // Server may send a blank result; the hook substitutes "Done." so the mic
    // still reopens when the queue drains.
    expect(fetchSpy.mock.calls.some(([u]) => String(u).includes("/api/speak"))).toBe(true);
  });
});

describe("useRealtimeVoice — barge-in (effectful)", () => {
  it("interrupt() stops TTS, clears the queue, kills the run, and reopens listening", async () => {
    const { hook, ws } = await bootHybrid();

    // Drive into a responding/TTS state by feeding a step (enqueues speak →
    // worker sets state "responding", creates an Audio clip, starts playing).
    await act(async () => {
      ws.fireMessage({ type: "ava.step", tool: "shell", args: { command: "ls" } });
    });
    await flush();
    expect(hook.result.current.state).toBe("responding");
    const clip = FakeAudio.created.at(-1)!;
    expect(clip.played).toBe(1);
    const speakCallsBefore = fetchSpy.mock.calls.filter(([u]) => String(u).includes("/api/speak")).length;

    // Barge in.
    await act(async () => { hook.result.current.interrupt(); });
    await flush();

    // (1) The server-side run is killed so tools stop executing.
    expect(killSpy).toHaveBeenCalledTimes(1);
    // (2) The currently-playing clip is halted (tts.pause()).
    expect(clip.paused).toBeGreaterThanOrEqual(1);
    // (3) State reset to listening (actionPending-driven reset is observable here).
    expect(hook.result.current.state).toBe("listening");

    // (4) The speak queue was cleared: queue another step's-worth of work would
    // have been pending, but nothing new is spoken after the barge-in. Feed a
    // late /api/speak-triggering frame is unnecessary — assert no extra clip
    // played and no extra speak fetch fired post-interrupt.
    await flush();
    const speakCallsAfter = fetchSpy.mock.calls.filter(([u]) => String(u).includes("/api/speak")).length;
    expect(speakCallsAfter).toBe(speakCallsBefore); // nothing queued kept draining
    expect(FakeAudio.created.length).toBe(1);       // no second clip was created
  });

  it("a clip queued behind the playing one does NOT continue after interrupt()", async () => {
    const { hook, ws } = await bootHybrid();

    // Two steps back-to-back: the first plays, the second is queued behind it
    // (the worker plays them strictly in order, one Audio at a time).
    await act(async () => {
      ws.fireMessage({ type: "ava.step", tool: "shell", args: { command: "one" } });
      ws.fireMessage({ type: "ava.step", tool: "shell", args: { command: "two" } });
    });
    await flush();
    // Only the first clip is playing so far (sequential queue, not yet drained).
    expect(FakeAudio.created.length).toBe(1);

    await act(async () => { hook.result.current.interrupt(); });
    await flush(8); // give the (now-aborted) worker loop every chance to drain

    // The queued second clip must never start — the epoch bump aborted the drain.
    expect(FakeAudio.created.length).toBe(1);
    expect(hook.result.current.state).toBe("listening");
  });

  it("interrupt() is safe before anything is speaking (no throw, returns to listening)", async () => {
    const { hook } = await bootHybrid();
    expect(() => act(() => { hook.result.current.interrupt(); })).not.toThrow();
    expect(hook.result.current.state).toBe("listening");
  });
});

describe("useRealtimeVoice — enter push-to-talk turn-taking (effectful)", () => {
  it("does NOT forward mic audio between turns (background/room audio stays local)", async () => {
    const { hook, ws } = await bootPtt();
    expect(hook.result.current.inputMode).toBe("enter_push_to_talk");
    expect(hook.result.current.capturing).toBe(false);

    // Even though state is "listening", PTT forwards ONLY while capturing — so an
    // un-pressed mic frame is dropped. This is the "TV won't interrupt me" guard.
    const node = FakeAudioWorkletNode.last!;
    act(() => { node.port.onmessage?.({ data: new ArrayBuffer(4800) }); });
    expect(ws.appendCount).toBe(0);
  });

  it("Enter starts a turn → mic forwards; Enter again commits the captured buffer", async () => {
    const { hook, ws } = await bootPtt();
    const node = FakeAudioWorkletNode.last!;

    // Press Enter (start the turn).
    act(() => { hook.result.current.togglePushToTalk(); });
    expect(hook.result.current.capturing).toBe(true);

    // Now mic frames forward upstream (a full ≥100ms buffer, so the commit guard
    // is satisfied).
    act(() => { node.port.onmessage?.({ data: new ArrayBuffer(4800) }); });
    expect(ws.appendCount).toBe(1);

    // Press Enter again (finish the turn) → commit is sent, state → thinking.
    act(() => { hook.result.current.togglePushToTalk(); });
    expect(ws.sent.some((s) => s.includes("input_audio_buffer.commit"))).toBe(true);
    expect(hook.result.current.capturing).toBe(false);
    expect(hook.result.current.state).toBe("thinking");
  });

  it("a too-short tap does NOT commit an empty buffer (keeps the turn open)", async () => {
    const { hook, ws } = await bootPtt();
    const node = FakeAudioWorkletNode.last!;

    act(() => { hook.result.current.togglePushToTalk(); }); // start
    // Forward only a tiny amount (< MIN_COMMIT_BYTES = 4800) of audio.
    act(() => { node.port.onmessage?.({ data: new ArrayBuffer(128) }); });

    act(() => { hook.result.current.togglePushToTalk(); }); // try to finish
    // The server would reject a sub-100ms buffer ("buffer too small … 0.00ms"),
    // so finishPtt refuses: no commit, and the turn stays open for more speech.
    expect(ws.sent.some((s) => s.includes("input_audio_buffer.commit"))).toBe(false);
    expect(hook.result.current.capturing).toBe(true);
  });
});
