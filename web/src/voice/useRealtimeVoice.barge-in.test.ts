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
  // The hook fetches the engine on mount and POSTs it on change. Resolve to the
  // same value the hook optimistically starts with so no engine-reconnect fires.
  fetchVoiceEngine: vi.fn(() => Promise.resolve("openai")),
  setVoiceEngine: vi.fn(() => Promise.resolve()),
  // The hook seeds the transcript scrollback from persisted session messages;
  // resolve to none so seeding is a no-op in these turn-taking tests.
  fetchSession: vi.fn(() => Promise.resolve({ session: {}, messages: [] })),
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
  it("forces a fresh canonical session when voice starts from a blank New chat", async () => {
    const hook = renderHook(() => useRealtimeVoice({ initialSessionId: null, startFresh: true }));
    await act(async () => { hook.result.current.start(); });
    await flush();

    const first = FakeWebSocket.last!;
    expect(first.url).toContain("new=1");
    expect(first.url).not.toContain("sessionId=");

    // The proxy acknowledgement consumes the one-shot fresh flag. Any later
    // reconnect resumes this exact session instead of creating another one.
    let acknowledgedImmediately: string | null = null;
    await act(async () => {
      first.fireOpen();
      first.fireMessage({ type: "ava.session", sessionId: "fresh-session", mode: "hybrid" });
      acknowledgedImmediately = hook.result.current.getSessionId();
    });
    expect(acknowledgedImmediately).toBe("fresh-session");
    await flush();
    hook.result.current.stop();
    // A real WebSocket emits close after close(); our minimal fake needs the
    // terminal event explicitly so the hook releases its starting guard.
    await act(async () => { first.fireClose(); });
    await act(async () => { hook.result.current.start(); });
    await flush();

    const resumed = FakeWebSocket.last!;
    expect(resumed).not.toBe(first);
    expect(resumed.url).toContain("sessionId=fresh-session");
    expect(resumed.url).not.toContain("new=1");
  });

  it("keeps null Home-orb voice entry on the existing resume-latest policy", async () => {
    const hook = renderHook(() => useRealtimeVoice({ initialSessionId: null }));
    await act(async () => { hook.result.current.start(); });
    await flush();

    expect(FakeWebSocket.last!.url).not.toContain("new=1");
    expect(FakeWebSocket.last!.url).not.toContain("sessionId=");
  });

  it("connects, latches hybrid, and lands in listening", async () => {
    const { hook } = await bootHybrid();
    expect(hook.result.current.state).toBe("listening");
  });

  it("closes the realtime socket when voice unmounts for keyboard/chat mode", async () => {
    const { hook, ws } = await bootHybrid();
    expect(ws.readyState).toBe(FakeWebSocket.OPEN);

    act(() => hook.unmount());

    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
  });

  it("keeps ava.step and ava.result visual-only so hybrid uses exactly one voice", async () => {
    const { hook, ws } = await bootHybrid();
    const node = FakeAudioWorkletNode.last!;

    fetchSpy.mockClear();

    await act(async () => {
      ws.fireMessage({ type: "ava.action", task: "open the website" });
      ws.fireMessage({ type: "ava.step", tool: "chrome_navigate", args: { url: "https://bing.com" } });
      ws.fireMessage({ type: "ava.result", text: "Opened it, Sir." });
    });
    await flush();

    expect(hook.result.current.caption).toEqual({ who: "ava", text: "Finishing…" });
    expect(hook.result.current.actionPending).toBe(true);
    expect(fetchSpy.mock.calls.some(([u]) => String(u).includes("/api/speak"))).toBe(false);
    expect(FakeAudio.created).toHaveLength(0);

    // The action remains busy until its same-model result response begins.
    const before = ws.appendCount;
    act(() => { node.port.onmessage?.({ data: new ArrayBuffer(256) }); });
    expect(ws.appendCount).toBe(before);
  });

  it("retains actionPending through status audio and clears it only for result audio", async () => {
    const { hook, ws } = await bootHybrid();

    // Arm a normal response, then start a computer action before a status/audio
    // chunk arrives. That audio is not proof that the action completed.
    await act(async () => {
      ws.fireMessage({
        type: "conversation.item.input_audio_transcription.completed",
        transcript: "open the site",
      });
      ws.fireMessage({ type: "response.created" });
      ws.fireMessage({ type: "ava.action", task: "open the website" });
      ws.fireMessage({ type: "response.output_audio.delta", delta: btoa("ABCD") });
    });
    await flush();

    expect(hook.result.current.state).toBe("responding");
    expect(hook.result.current.actionPending).toBe(true);

    // ava.result explicitly arms a fresh same-model response. Its first audio
    // chunk is legitimate completion evidence and releases the busy guard.
    await act(async () => {
      ws.fireMessage({ type: "ava.result", text: "Opened it, Sir." });
      ws.fireMessage({ type: "response.created" });
      ws.fireMessage({ type: "response.output_audio.delta", delta: btoa("ABCD") });
    });
    await flush();
    expect(hook.result.current.actionPending).toBe(false);
  });

  it("uses a silent text fallback when the result response contains no voice audio", async () => {
    const { hook, ws } = await bootHybrid();

    await act(async () => {
      ws.fireMessage({ type: "ava.action", task: "open the website" });
      ws.fireMessage({ type: "ava.result", text: "Done, Sir." });
      ws.fireMessage({ type: "response.created" });
      ws.fireMessage({ type: "response.done" });
    });
    await flush();

    expect(hook.result.current.actionPending).toBe(false);
    expect(hook.result.current.caption).toEqual({ who: "ava", text: "Done, Sir." });
    expect(fetchSpy.mock.calls.some(([u]) => String(u).includes("/api/speak"))).toBe(false);
  });
});

describe("useRealtimeVoice — barge-in (effectful)", () => {
  it("explicit interrupt() cancels a pending action, kills the run, and reopens listening", async () => {
    const { hook, ws } = await bootHybrid();

    await act(async () => {
      ws.fireMessage({ type: "ava.action", task: "search the web" });
    });
    await flush();
    expect(hook.result.current.actionPending).toBe(true);
    expect(hook.result.current.state).toBe("thinking");

    await act(async () => { hook.result.current.interrupt(); });
    await flush();

    expect(killSpy).toHaveBeenCalledTimes(1);
    expect(hook.result.current.actionPending).toBe(false);
    expect(hook.result.current.state).toBe("listening");
  });

  it("interrupt() is safe before anything is speaking (no throw, returns to listening)", async () => {
    const { hook } = await bootHybrid();
    expect(() => act(() => { hook.result.current.interrupt(); })).not.toThrow();
    expect(hook.result.current.state).toBe("listening");
  });
});

// Item 1 (CRITICAL): in hybrid CHIT-CHAT Ava's voice is the realtime model
// streaming `response.output_audio.delta` (the play_audio branch), NOT TTS. The
// barge-in must (a) tell the realtime model to STOP (response.cancel upstream),
// and (b) DROP any late deltas already in flight so her cancelled tail can't
// resume playing / re-arm "responding" after the barge-in.
describe("useRealtimeVoice — barge-in on the realtime audio (play_audio) path", () => {
  // 4 bytes → 2 PCM16 samples, enough for the player to schedule a source so
  // `playing` is true (the FakeBufferSource never fires onended on its own).
  const AUDIO_B64 = btoa("ABCD");

  async function speakViaRealtime(ws: FakeWebSocket) {
    // A gate-accepted user turn arms this response; response.created by itself is
    // deliberately insufficient after a cancellation because it may be a late tail.
    await act(async () => {
      ws.fireMessage({
        type: "conversation.item.input_audio_transcription.completed",
        transcript: "test turn",
      });
    });
    await act(async () => { ws.fireMessage({ type: "response.created" }); });
    await act(async () => { ws.fireMessage({ type: "response.output_audio.delta", delta: AUDIO_B64 }); });
    await flush();
  }

  it("a realtime audio delta plays and arms 'responding' (positive control)", async () => {
    const { hook, ws } = await bootHybrid();
    await speakViaRealtime(ws);
    expect(hook.result.current.state).toBe("responding");
  });

  it("interrupt() sends response.cancel + input_audio_buffer.clear upstream", async () => {
    const { hook, ws } = await bootHybrid();
    await speakViaRealtime(ws);
    expect(hook.result.current.state).toBe("responding");

    await act(async () => { hook.result.current.interrupt(); });
    await flush();

    // Without these upstream frames the realtime model keeps generating and the
    // next delta resumes her — this is the core of the reported bug.
    expect(ws.sent.some((s) => s.includes("response.cancel"))).toBe(true);
    expect(ws.sent.some((s) => s.includes("input_audio_buffer.clear"))).toBe(true);
    expect(hook.result.current.state).toBe("listening");
  });

  it("a LATE audio delta after a barge-in is DROPPED (does not re-arm responding)", async () => {
    const { hook, ws } = await bootHybrid();
    await speakViaRealtime(ws);

    await act(async () => { hook.result.current.interrupt(); });
    await flush();
    expect(hook.result.current.state).toBe("listening");

    // A delta from the just-cancelled turn arrives after the barge-in (it was in
    // flight before response.cancel landed). The epoch advanced, so it must be
    // ignored: Ava stays silent and the mic stays open.
    await act(async () => { ws.fireMessage({ type: "response.output_audio.delta", delta: AUDIO_B64 }); });
    await flush();
    expect(hook.result.current.state).toBe("listening");
  });

  it("a fresh turn's audio plays again after a barge-in (the drop is per-turn, not permanent)", async () => {
    const { hook, ws } = await bootHybrid();
    await speakViaRealtime(ws);
    await act(async () => { hook.result.current.interrupt(); });
    await flush();
    expect(hook.result.current.state).toBe("listening");

    // A brand-new accepted turn refreshes the epoch, so its audio is allowed.
    await speakViaRealtime(ws);
    expect(hook.result.current.state).toBe("responding");
  });
});

// Item 3: a transcript can be gate-accepted MID-TASK (the do_on_computer
// tool-call response emits response.done while the tools are still running). When
// that happens the caption_user handler must NOT clear the action guards, or the
// end-of-turn settle reopens the mic into a still-running task and Ava re-hears
// herself. The guards stay set until the task's own result clears them.
describe("useRealtimeVoice — caption_user must not reopen the mic mid-task (Item 3)", () => {
  it("a transcript accepted while a task runs keeps the mic closed at the settle", async () => {
    const { hook, ws } = await bootHybrid();

    // A do_on_computer task starts → actionPending; the mic is held closed.
    await act(async () => { ws.fireMessage({ type: "ava.action", task: "search the web" }); });
    await flush();
    expect(hook.result.current.state).toBe("thinking");
    expect(hook.result.current.actionPending).toBe(true);

    // Switch to fake timers now (after the async boot) so we can drive the 350ms
    // settle deterministically without a real wait.
    vi.useFakeTimers();

    // A transcript is accepted WHILE the task is still running (the tool-call
    // response already emitted response.done). Pre-fix this cleared actionPending.
    act(() => {
      ws.fireMessage({ type: "conversation.item.input_audio_transcription.completed", transcript: "are you done yet" });
    });
    // response.done for that window → schedules the end-of-turn settle.
    act(() => { ws.fireMessage({ type: "response.done" }); });
    // Advance past the 350ms fast settle.
    act(() => { vi.advanceTimersByTime(400); });

    // The task is still running, so the mic must NOT have reopened — state stays
    // "thinking" (the action guard held). Pre-fix it would be "listening".
    expect(hook.result.current.state).toBe("thinking");
    expect(hook.result.current.actionPending).toBe(true);
  });

  it("with NO task running, a transcript still opens a normal turn (control)", async () => {
    const { hook, ws } = await bootHybrid();
    expect(hook.result.current.state).toBe("listening");

    // No ava.action first → not mid-task. An accepted transcript opens a turn
    // (state → thinking) exactly as before; the guard change doesn't regress this.
    act(() => {
      ws.fireMessage({ type: "conversation.item.input_audio_transcription.completed", transcript: "what time is it" });
    });
    expect(hook.result.current.state).toBe("thinking");
  });
});

describe("useRealtimeVoice — hold-to-talk turn-taking (effectful)", () => {
  it("does NOT forward mic audio between turns (background/room audio stays local)", async () => {
    const { hook, ws } = await bootPtt();
    expect(hook.result.current.inputMode).toBe("enter_push_to_talk");
    expect(hook.result.current.capturing).toBe(false);

    // Even though state is "listening", PTT forwards ONLY while capturing — so an
    // un-held mic frame is dropped. This is the "TV won't interrupt me" guard.
    const node = FakeAudioWorkletNode.last!;
    act(() => { node.port.onmessage?.({ data: new ArrayBuffer(4800) }); });
    expect(ws.appendCount).toBe(0);
  });

  it("hold (startPtt) forwards mic; release (finishPtt) commits the captured buffer", async () => {
    const { hook, ws } = await bootPtt();
    const node = FakeAudioWorkletNode.last!;

    // Press-and-hold (pointer down / Space down → startPtt).
    act(() => { hook.result.current.startPtt(); });
    expect(hook.result.current.capturing).toBe(true);

    // Now mic frames forward upstream (a full ≥100ms buffer, so the commit guard
    // is satisfied).
    act(() => { node.port.onmessage?.({ data: new ArrayBuffer(4800) }); });
    expect(ws.appendCount).toBe(1);

    // Release (pointer up / Space up → finishPtt) → commit is sent, state → thinking.
    act(() => { hook.result.current.finishPtt(); });
    expect(ws.sent.some((s) => s.includes("input_audio_buffer.commit"))).toBe(true);
    expect(hook.result.current.capturing).toBe(false);
    expect(hook.result.current.state).toBe("thinking");
  });

  it("a too-short hold does NOT commit an empty buffer and surfaces a 'hold longer' hint", async () => {
    const { hook, ws } = await bootPtt();
    const node = FakeAudioWorkletNode.last!;

    act(() => { hook.result.current.startPtt(); }); // hold
    // Forward only a tiny amount (< MIN_COMMIT_BYTES = 4800) of audio.
    act(() => { node.port.onmessage?.({ data: new ArrayBuffer(128) }); });

    act(() => { hook.result.current.finishPtt(); }); // release too fast
    // The server would reject a sub-100ms buffer ("buffer too small … 0.00ms"), so
    // finishPtt refuses to commit — and tells the owner they released early instead
    // of silently no-op'ing. Capture ends (they let go of the key/button).
    expect(ws.sent.some((s) => s.includes("input_audio_buffer.commit"))).toBe(false);
    expect(hook.result.current.capturing).toBe(false);
    expect(hook.result.current.hint).toMatch(/hold/i);
  });

  it("togglePushToTalk still works as the secondary tap affordance", async () => {
    const { hook, ws } = await bootPtt();
    const node = FakeAudioWorkletNode.last!;
    act(() => { hook.result.current.togglePushToTalk(); }); // tap → start
    expect(hook.result.current.capturing).toBe(true);
    act(() => { node.port.onmessage?.({ data: new ArrayBuffer(4800) }); });
    act(() => { hook.result.current.togglePushToTalk(); }); // tap → finish
    expect(ws.sent.some((s) => s.includes("input_audio_buffer.commit"))).toBe(true);
    expect(hook.result.current.state).toBe("thinking");
  });

  it("startPtt while Ava is responding interrupts her first (explicit new turn)", async () => {
    const { hook, ws } = await bootPtt();
    // Latch hybrid so the realtime model's audio actually drives "responding".
    await act(async () => { ws.fireMessage({ type: "ava.session", sessionId: "s0", mode: "hybrid" }); });
    await act(async () => {
      ws.fireMessage({
        type: "conversation.item.input_audio_transcription.completed",
        transcript: "tell me something",
      });
    });
    await act(async () => { ws.fireMessage({ type: "response.created" }); });
    await act(async () => { ws.fireMessage({ type: "response.output_audio.delta", delta: btoa("ABCD") }); });
    await flush();
    expect(hook.result.current.state).toBe("responding");

    act(() => { hook.result.current.startPtt(); });
    // interrupt() ran → response.cancel sent upstream and we're capturing a new turn.
    expect(ws.sent.some((s) => s.includes("response.cancel"))).toBe(true);
    expect(hook.result.current.capturing).toBe(true);
  });
});

// Fix (stuck-in-thinking): finishPtt flips to "thinking" BEFORE the server accepts
// the commit. If nothing comes back, the client recovers to "listening" — via a
// timer, or (deterministically) via the proxy's `ava.recover` frame.
describe("useRealtimeVoice — push-to-talk stuck-in-thinking recovery", () => {
  it("recovers to listening with a soft hint after the timeout when no reply arrives", async () => {
    const { hook } = await bootPtt();
    const node = FakeAudioWorkletNode.last!;
    vi.useFakeTimers();

    act(() => { hook.result.current.startPtt(); });
    act(() => { node.port.onmessage?.({ data: new ArrayBuffer(4800) }); });
    act(() => { hook.result.current.finishPtt(); });
    expect(hook.result.current.state).toBe("thinking");

    // No transcript / response / audio comes back. Past the recovery window we
    // re-arm listening and hint the owner instead of hanging in "thinking" forever.
    act(() => { vi.advanceTimersByTime(6000); });
    expect(hook.result.current.state).toBe("listening");
    expect(hook.result.current.hint).toMatch(/didn't catch/i);
  });

  it("an accepted transcript cancels the recovery timer (no false 'didn't catch that')", async () => {
    const { hook, ws } = await bootPtt();
    await act(async () => { ws.fireMessage({ type: "ava.session", sessionId: "s0", mode: "hybrid" }); });
    const node = FakeAudioWorkletNode.last!;
    vi.useFakeTimers();

    act(() => { hook.result.current.startPtt(); });
    act(() => { node.port.onmessage?.({ data: new ArrayBuffer(4800) }); });
    act(() => { hook.result.current.finishPtt(); });
    expect(hook.result.current.state).toBe("thinking");

    // The server accepts the turn → caption_user. This disarms the recovery.
    act(() => { ws.fireMessage({ type: "conversation.item.input_audio_transcription.completed", transcript: "what time is it" }); });
    act(() => { vi.advanceTimersByTime(8000); });
    expect(hook.result.current.state).toBe("thinking"); // a reply is coming
    expect(hook.result.current.hint).toBeNull();          // no stale recovery hint
  });

  it("the proxy's ava.recover frame recovers immediately (deterministic, no timer)", async () => {
    const { hook, ws } = await bootPtt();
    const node = FakeAudioWorkletNode.last!;

    act(() => { hook.result.current.startPtt(); });
    act(() => { node.port.onmessage?.({ data: new ArrayBuffer(4800) }); });
    act(() => { hook.result.current.finishPtt(); });
    expect(hook.result.current.state).toBe("thinking");

    act(() => { ws.fireMessage({ type: "ava.recover", reason: "empty" }); });
    expect(hook.result.current.state).toBe("listening");
    expect(hook.result.current.hint).toMatch(/didn't catch/i);
  });
});

// Fix (transcript display): committed You/Ava turns accumulate into a scrollback so
// the user's words don't vanish when Ava replies, and Ava's streaming rides ONE
// stable interim line (no per-token remount / re-animation).
describe("useRealtimeVoice — transcript scrollback + interim line", () => {
  it("holds an incomplete VAD fragment visibly without committing or responding", async () => {
    const { hook, ws } = await bootHybrid();

    await act(async () => {
      ws.fireMessage({ type: "ava.transcript_pending", text: "I want you to go" });
    });
    expect(hook.result.current.state).toBe("listening");
    expect(hook.result.current.interim).toEqual({
      who: "you",
      text: "I want you to go …",
    });
    expect(hook.result.current.turns).toEqual([]);

    await act(async () => {
      ws.fireMessage({ type: "ava.recover", reason: "incomplete_fragment" });
    });
    expect(hook.result.current.state).toBe("listening");
    expect(hook.result.current.interim).toBeNull();
    expect(hook.result.current.hint).toContain("finish the thought");
  });

  it("commits the user turn and Ava's turn as separate scrollback rows", async () => {
    const { hook, ws } = await bootHybrid();

    await act(async () => { ws.fireMessage({ type: "conversation.item.input_audio_transcription.completed", transcript: "hey ava" }); });
    await act(async () => { ws.fireMessage({ type: "response.created" }); });
    await act(async () => { ws.fireMessage({ type: "response.output_audio_transcript.delta", delta: "hi " }); });
    await act(async () => { ws.fireMessage({ type: "response.output_audio_transcript.delta", delta: "Sir" }); });
    await act(async () => { ws.fireMessage({ type: "response.output_audio_transcript.done", transcript: "hi Sir" }); });
    await flush();

    const turns = hook.result.current.turns;
    expect(turns.map((t) => [t.who, t.text])).toEqual([
      ["you", "hey ava"],
      ["ava", "hi Sir"],
    ]);
    // The user's turn is still present after Ava replied (it no longer vanishes).
    expect(turns[0]).toMatchObject({ who: "you", text: "hey ava" });
  });

  it("Ava's streaming updates one stable interim line and keeps the completed line visible", async () => {
    const { hook, ws } = await bootHybrid();

    await act(async () => {
      ws.fireMessage({
        type: "conversation.item.input_audio_transcription.completed",
        transcript: "say one two",
      });
      ws.fireMessage({ type: "response.created" });
    });
    await act(async () => { ws.fireMessage({ type: "response.output_audio_transcript.delta", delta: "one " }); });
    expect(hook.result.current.interim).toEqual({ who: "ava", text: "one " });
    await act(async () => { ws.fireMessage({ type: "response.output_audio_transcript.delta", delta: "two" }); });
    // Same interim line, text updated in place (no per-token remount).
    expect(hook.result.current.interim).toEqual({ who: "ava", text: "one two" });

    await act(async () => { ws.fireMessage({ type: "response.output_audio_transcript.done", transcript: "one two" }); });
    await flush();
    expect(hook.result.current.interim).toEqual({ who: "ava", text: "one two" });
    expect(hook.result.current.turns.at(-1)).toMatchObject({ who: "ava", text: "one two" });
  });
});

// Fix (second-mic + orb honesty): amplitude is derived from the SAME forwarded PCM,
// so there is no second getUserMedia and the meter only reacts when audio is sent.
describe("useRealtimeVoice — amplitude from the forwarded PCM (no second mic)", () => {
  it("rises on a loud forwarded frame while listening", async () => {
    const { hook } = await bootHybrid();
    const node = FakeAudioWorkletNode.last!;
    expect(hook.result.current.amplitude).toBe(0);

    const buf = new Int16Array([20000, -20000, 20000, -20000]).buffer;
    act(() => { node.port.onmessage?.({ data: buf }); });
    expect(hook.result.current.amplitude).toBeGreaterThan(0);
  });

  it("stays 0 in push-to-talk between turns (mic closed → orb calm)", async () => {
    const { hook, ws } = await bootPtt();
    const node = FakeAudioWorkletNode.last!;
    const buf = new Int16Array([20000, -20000, 20000, -20000]).buffer;
    act(() => { node.port.onmessage?.({ data: buf }); });
    expect(hook.result.current.amplitude).toBe(0);
    expect(ws.appendCount).toBe(0);
  });
});

// Fix (voice barge-in): a server-driven ava.barge_in frame stops Ava's audio
// locally so her tail can't keep playing after the owner talked over her.
describe("useRealtimeVoice — server-driven voice barge-in", () => {
  it("ava.barge_in stops the realtime audio, clears the interim, and drops the late tail", async () => {
    const { hook, ws } = await bootHybrid();
    await act(async () => {
      ws.fireMessage({
        type: "conversation.item.input_audio_transcription.completed",
        transcript: "tell me something",
      });
    });
    await act(async () => { ws.fireMessage({ type: "response.created" }); });
    await act(async () => { ws.fireMessage({ type: "response.output_audio.delta", delta: btoa("ABCD") }); });
    await act(async () => { ws.fireMessage({ type: "response.output_audio_transcript.delta", delta: "let me tell you" }); });
    await flush();
    expect(hook.result.current.state).toBe("responding");
    expect(hook.result.current.interim).not.toBeNull();

    await act(async () => { ws.fireMessage({ type: "ava.barge_in" }); });
    await flush();
    expect(hook.result.current.interim).toBeNull();

    // A LATE delta from the cancelled turn must be dropped (epoch advanced).
    await act(async () => { ws.fireMessage({ type: "response.output_audio.delta", delta: btoa("ABCD") }); });
    await flush();
    expect(hook.result.current.state).not.toBe("responding");
  });

  it("ava.barge_in never marks an in-flight computer action complete", async () => {
    const { hook, ws } = await bootHybrid();

    await act(async () => {
      ws.fireMessage({ type: "ava.action", task: "open the website" });
      ws.fireMessage({ type: "ava.step", tool: "chrome_navigate", args: { url: "https://example.com" } });
    });
    await flush();
    expect(hook.result.current.actionPending).toBe(true);

    await act(async () => { ws.fireMessage({ type: "ava.barge_in" }); });
    await flush();

    // Speech onset only stopped playback; it did not provide completion evidence.
    expect(hook.result.current.actionPending).toBe(true);
  });
});
