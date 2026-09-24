// @vitest-environment jsdom
// The WebGL dotted surface behind voice is decorative (contract i3a-navigation
// v2): it loads lazily, never delays or breaks the voice controls, and is never
// requested under reduced motion or without WebGL.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const voice = vi.hoisted(() => ({ stop: vi.fn(), start: vi.fn() }));
const dotted = vi.hoisted(() => ({ loads: 0 }));

vi.mock("./useRealtimeVoice.js", () => ({
  useRealtimeVoice: () => ({
    state: "listening",
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
    actionPending: false,
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
vi.mock("../components/ava/Orb.js", () => ({ Orb: () => <div data-testid="orb" /> }));
vi.mock("../components/ava/MagicRings.js", () => ({ MagicRings: () => null }));
vi.mock("../components/ava/NebulaBackground.js", () => ({ NebulaBackground: () => null }));
vi.mock("../lib/gsap.js", () => ({ gsap: { fromTo: vi.fn() }, useGSAP: vi.fn() }));

const originalGetContext = HTMLCanvasElement.prototype.getContext;

async function loadVoice(options: { reduced: boolean; chunk: "pending" | "rejects" | "resolves" }) {
  vi.resetModules();
  dotted.loads = 0;
  vi.doMock("../lib/useReducedMotion.js", () => ({ useReducedMotion: () => options.reduced }));
  vi.doMock("../components/ava/DottedSurface.js", () => {
    dotted.loads += 1;
    if (options.chunk === "rejects") throw new Error("decorative chunk failed to load");
    if (options.chunk === "pending") return new Promise(() => {});
    return { DottedSurface: () => <div data-testid="webgl-surface" /> };
  });
  return (await import("./VoiceScreen.js")).VoiceScreen;
}

beforeEach(() => {
  // jsdom has no WebGL; pretend it does so the animated path is chosen.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ getExtension: () => null })) as unknown as typeof originalGetContext;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  vi.restoreAllMocks();
  vi.doUnmock("../lib/useReducedMotion.js");
  vi.doUnmock("../components/ava/DottedSurface.js");
});

async function flush() {
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
}

describe("VoiceScreen decorative background", () => {
  it("keeps every voice control usable while the background is still loading", async () => {
    const VoiceScreen = await loadVoice({ reduced: false, chunk: "pending" });
    const onExit = vi.fn();
    render(<VoiceScreen initialSessionId="shared-session" onExit={onExit} onSwitchToKeyboard={vi.fn()} />);
    await flush();
    expect(document.querySelector("[data-voice-surface='static']")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "exit" }));
    expect(onExit).toHaveBeenCalledWith("shared-session");
  });

  it("falls back to the static backdrop when the background fails to load", async () => {
    const VoiceScreen = await loadVoice({ reduced: false, chunk: "rejects" });
    const onSwitchToKeyboard = vi.fn();
    render(<VoiceScreen initialSessionId="shared-session" onExit={vi.fn()} onSwitchToKeyboard={onSwitchToKeyboard} />);
    await flush();
    expect(document.querySelector("[data-voice-surface='static']")).not.toBeNull();
    expect(screen.queryByTestId("webgl-surface")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "keyboard" }));
    expect(onSwitchToKeyboard).toHaveBeenCalledWith("shared-session");
  });

  it("shows the animated surface once it loads", async () => {
    const VoiceScreen = await loadVoice({ reduced: false, chunk: "resolves" });
    render(<VoiceScreen initialSessionId="shared-session" onExit={vi.fn()} onSwitchToKeyboard={vi.fn()} />);
    expect(await screen.findByTestId("webgl-surface")).not.toBeNull();
  });

  it("never requests the WebGL module under reduced motion", async () => {
    const VoiceScreen = await loadVoice({ reduced: true, chunk: "resolves" });
    render(<VoiceScreen initialSessionId="shared-session" onExit={vi.fn()} onSwitchToKeyboard={vi.fn()} />);
    await flush();
    expect(dotted.loads).toBe(0);
    expect(document.querySelector("[data-voice-surface='static']")).not.toBeNull();
  });

  it("never requests the WebGL module without WebGL", async () => {
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as typeof originalGetContext;
    const VoiceScreen = await loadVoice({ reduced: false, chunk: "resolves" });
    render(<VoiceScreen initialSessionId="shared-session" onExit={vi.fn()} onSwitchToKeyboard={vi.fn()} />);
    await flush();
    expect(dotted.loads).toBe(0);
  });
});
