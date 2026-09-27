// @vitest-environment jsdom
// Voice's face (contract ui-remodel v3 §5-6, face-signal v1): AVA's face is the
// one animated surface, loaded lazily so the controls never wait for it, with
// the still face if it fails. It and the island follow the shared face signal,
// and only a measured voice level ever drives her mouth.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FaceStageProps } from "../design/face/FaceStage.js";

const voice = vi.hoisted(() => ({
  stop: vi.fn(),
  start: vi.fn(),
  state: "listening" as "listening" | "thinking" | "responding" | "connecting",
  actionPending: false,
}));
const face = vi.hoisted(() => ({ loads: 0, props: [] as FaceStageProps[] }));

vi.mock("./useRealtimeVoice.js", () => ({
  useRealtimeVoice: () => ({
    state: voice.state,
    sessionId: "shared-session",
    getSessionId: () => "shared-session",
    unavailable: false,
    caption: null,
    turns: [],
    interim: null,
    amplitude: 0,
    hint: null,
    clearHint: vi.fn(),
    errorMsg: null,
    clearError: vi.fn(),
    muted: false,
    setMuted: vi.fn(),
    pendingApproval: null,
    actionPending: voice.actionPending,
    approve: vi.fn(),
    deny: vi.fn(),
    start: voice.start,
    stop: voice.stop,
    interrupt: vi.fn(),
    submitExactText: vi.fn(async () => true),
    newConversation: vi.fn(),
    inputMode: "vad",
    setInputMode: vi.fn(),
    capturing: false,
    startPtt: vi.fn(),
    finishPtt: vi.fn(),
    togglePushToTalk: vi.fn(),
    voiceEngine: "openai",
    setVoiceEngine: vi.fn(),
  }),
}));
vi.mock("../design/face/FaceStill.js", () => ({ FaceStill: () => <span data-testid="still-face" /> }));

async function loadVoice(chunk: "pending" | "rejects" | "resolves") {
  vi.resetModules();
  face.loads = 0;
  face.props = [];
  vi.doMock("../design/face/FaceStage.js", () => {
    face.loads += 1;
    if (chunk === "rejects") throw new Error("face chunk failed to load");
    if (chunk === "pending") return new Promise(() => {});
    return {
      FaceStage: (props: FaceStageProps) => {
        face.props.push(props);
        return <div data-testid="live-face" data-mode={props.mode} />;
      },
    };
  });
  const signal = await import("./faceSignal.js");
  signal.resetFaceSignalForTests();
  const { RealtimeVoiceScreen } = await import("./VoiceScreen.js");
  return { VoiceScreen: RealtimeVoiceScreen, signal };
}

async function flush() {
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
}

const island = () => document.querySelector<HTMLElement>(".ds-island")!;
const lastFace = () => face.props.at(-1)!;

beforeEach(() => {
  voice.state = "listening";
  voice.actionPending = false;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.doUnmock("../design/face/FaceStage.js");
});

describe("VoiceScreen face", () => {
  it("keeps every voice control usable while the face is still loading", async () => {
    const { VoiceScreen } = await loadVoice("pending");
    const onExit = vi.fn();
    render(<VoiceScreen initialSessionId="shared-session" onExit={onExit} onSwitchToKeyboard={vi.fn()} />);
    await flush();
    expect(screen.getByTestId("still-face")).toBeTruthy();
    expect(screen.queryByTestId("live-face")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "exit" }));
    expect(onExit).toHaveBeenCalledWith("shared-session");
  });

  it("shows the still face when the face fails to load, and nothing else changes", async () => {
    const { VoiceScreen } = await loadVoice("rejects");
    render(<VoiceScreen initialSessionId="shared-session" onExit={vi.fn()} onSwitchToKeyboard={vi.fn()} />);
    await flush();
    expect(face.loads).toBe(1);
    expect(screen.getByTestId("still-face")).toBeTruthy();
    expect(screen.getByRole("button", { name: "keyboard" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "type exact text in voice" })).toBeTruthy();
  });

  it("shows one live face once it loads", async () => {
    const { VoiceScreen } = await loadVoice("resolves");
    render(<VoiceScreen initialSessionId="shared-session" onExit={vi.fn()} onSwitchToKeyboard={vi.fn()} />);
    await flush();
    expect(screen.getAllByTestId("live-face")).toHaveLength(1);
    expect(screen.queryByTestId("still-face")).toBeNull();
    expect(document.querySelector(".ds-voice-face")).toBeTruthy();
    expect(document.querySelector('[data-atmosphere="nocturne"]')).toBeTruthy();
    await waitFor(() => expect(document.querySelector('[data-metal-stars]')?.getAttribute("aria-hidden")).toBe("true"));
  });

  it("follows the shared face signal: island and face pose change with what AVA is audibly doing", async () => {
    const { VoiceScreen, signal } = await loadVoice("resolves");
    render(<VoiceScreen initialSessionId="shared-session" onExit={vi.fn()} onSwitchToKeyboard={vi.fn()} />);
    await flush();
    const writer = signal.claimFaceSignalWriter("test");

    act(() => { writer.setMode("listening"); });
    expect(island().getAttribute("data-mode")).toBe("listening");
    expect(lastFace().mode).toBe("listening");

    act(() => { writer.setMode("thinking"); });
    expect(island().getAttribute("data-mode")).toBe("thinking");
    expect(lastFace().mode).toBe("thinking");

    act(() => { writer.setMode("speaking"); });
    expect(island().getAttribute("data-mode")).toBe("speaking");
    expect(lastFace().mode).toBe("speaking");
  });

  it("drives her mouth only from a measured level, never a synthetic one", async () => {
    const { VoiceScreen, signal } = await loadVoice("resolves");
    render(<VoiceScreen initialSessionId="shared-session" onExit={vi.fn()} onSwitchToKeyboard={vi.fn()} />);
    await flush();
    const writer = signal.claimFaceSignalWriter("test");
    const sampleLevel = lastFace().sampleLevel!;
    expect(sampleLevel).toBeTypeOf("function");
    // The level is read per frame, not passed through React.
    expect(lastFace().level ?? null).toBeNull();

    act(() => { writer.setMode("speaking"); writer.setOutputSource("measured", () => 0.2); });
    expect(sampleLevel()).toBeCloseTo(0.6);
    act(() => { writer.setOutputSource("measured", () => 0.9); });
    expect(sampleLevel()).toBe(1);
    act(() => { writer.setOutputSource("synthetic"); });
    expect(sampleLevel()).toBeNull();
    act(() => { writer.setOutputSource("none"); });
    expect(sampleLevel()).toBeNull();
  });

  it("reads a running action as thinking in the face and working in the island", async () => {
    voice.actionPending = true;
    voice.state = "thinking";
    const { VoiceScreen, signal } = await loadVoice("resolves");
    render(<VoiceScreen initialSessionId="shared-session" onExit={vi.fn()} onSwitchToKeyboard={vi.fn()} />);
    await flush();
    act(() => { signal.claimFaceSignalWriter("test").setMode("idle"); });
    expect(lastFace().mode).toBe("thinking");
    expect(island().getAttribute("data-mode")).toBe("working");
  });
});
