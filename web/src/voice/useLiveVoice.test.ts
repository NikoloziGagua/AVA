// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getFaceSignalMode,
  resetFaceSignalForTests,
  sampleFaceSignalLevels,
} from "./faceSignal.js";
import { useLiveVoice } from "./useLiveVoice.js";

vi.mock("../auth/tokens.js", () => ({ getToken: () => "test-token" }));

class FakeSocket {
  static OPEN = 1;
  static last: FakeSocket | null = null;
  readyState = FakeSocket.OPEN;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  constructor(readonly url: string) { FakeSocket.last = this; }
  send(value: string) { this.sent.push(value); }
  close() { this.readyState = 3; }
  fire(payload: unknown) { this.onmessage?.({ data: JSON.stringify(payload) }); }
  fireClose() { this.readyState = 3; this.onclose?.(); }
}

class FakeSource {
  buffer: { duration: number } | null = null;
  onended: (() => void) | null = null;
  start() {}
  stop() {}
  connect() {}
  disconnect() {}
}

class FakeAnalyser {
  fftSize = 256;
  smoothingTimeConstant = 0;
  getFloatTimeDomainData(target: Float32Array) { target.fill(0.3); }
  disconnect() {}
}

class FakeContext {
  state = "running";
  currentTime = 0;
  audioWorklet = { addModule: vi.fn(async () => {}) };
  destination = {};
  resume = vi.fn(async () => { this.state = "running"; });
  close = vi.fn(async () => {});
  createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
  createBuffer(_channels: number, length: number, rate: number) {
    return { duration: length / rate, getChannelData: () => new Float32Array(length) };
  }
  createBufferSource() { return new FakeSource() as unknown as AudioBufferSourceNode; }
  createAnalyser() { return new FakeAnalyser() as unknown as AnalyserNode; }
}

class FakeWorklet {
  static last: FakeWorklet | null = null;
  port = { onmessage: null as ((event: { data: ArrayBuffer }) => void) | null, close: vi.fn() };
  constructor() { FakeWorklet.last = this; }
  connect() {}
  disconnect() {}
}

function pcm(samples: number[]): ArrayBuffer {
  return Int16Array.from(samples).buffer;
}

function pcmBase64(samples: number[]): string {
  const bytes = new Uint8Array(pcm(samples));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function flush() {
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  resetFaceSignalForTests();
  FakeSocket.last = null;
  FakeWorklet.last = null;
  localStorage.clear();
  const globals = globalThis as Record<string, unknown>;
  globals.WebSocket = FakeSocket as unknown;
  globals.AudioContext = FakeContext as unknown;
  globals.AudioWorkletNode = FakeWorklet as unknown;
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => "blob:worklet");
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [{ stop: vi.fn() }],
        getAudioTracks: () => [{ enabled: true }],
      } as unknown as MediaStream)),
    },
  });
  vi.spyOn(performance, "now").mockReturnValue(1_000);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetFaceSignalForTests();
  localStorage.clear();
});

describe("useLiveVoice face signal producer", () => {
  it("publishes listening, forwarded input, measured playback, interruption and disconnect", async () => {
    const hook = renderHook(() => useLiveVoice({ initialSessionId: "voice-1" }));
    await act(async () => { await hook.result.current.start(); });
    await flush();
    const socket = FakeSocket.last!;

    await act(async () => { socket.fire({ type: "ava.session", sessionId: "voice-1" }); });
    expect(getFaceSignalMode()).toBe("listening");

    const input = pcm([20_000, -20_000, 20_000, -20_000]);
    act(() => { FakeWorklet.last!.port.onmessage?.({ data: input }); });
    expect(sampleFaceSignalLevels(1_000).input).toBeGreaterThan(0);

    await act(async () => {
      socket.fire({ type: "response.output_audio.delta", delta: pcmBase64([10_000, -10_000, 10_000, -10_000]) });
    });
    expect(getFaceSignalMode()).toBe("speaking");
    expect(sampleFaceSignalLevels().outputSource).toBe("measured");
    expect(sampleFaceSignalLevels().output).toBeCloseTo(0.3, 5);

    act(() => { hook.result.current.interrupt(); });
    expect(getFaceSignalMode()).toBe("listening");
    expect(sampleFaceSignalLevels().output).toBe(0);

    act(() => { socket.fireClose(); });
    expect(getFaceSignalMode()).toBe("idle");
  });

  it("keeps push-to-talk idle until the owner starts capture", async () => {
    localStorage.setItem("ava.voiceInputMode", "enter_push_to_talk");
    const hook = renderHook(() => useLiveVoice({ initialSessionId: "voice-2" }));
    await act(async () => { await hook.result.current.start(); });
    await flush();
    await act(async () => { FakeSocket.last!.fire({ type: "ava.session", sessionId: "voice-2" }); });
    expect(getFaceSignalMode()).toBe("idle");
    act(() => { hook.result.current.startPtt(); });
    expect(getFaceSignalMode()).toBe("listening");
  });
});
