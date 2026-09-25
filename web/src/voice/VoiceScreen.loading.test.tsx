// @vitest-environment jsdom
// Before voice knows which engine to use it shows a calm, announced loading
// state: no blank screen, no microphone, no connection, no WebGL.
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const voice = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), engine: null as null | ((value: string) => void) }));

vi.mock("../api.js", () => ({
  fetchVoiceEngine: () => new Promise((resolve) => { voice.engine = resolve; }),
}));
vi.mock("./useRealtimeVoice.js", () => ({
  useRealtimeVoice: () => ({
    state: "connecting", sessionId: null, getSessionId: () => null, unavailable: false, caption: null, turns: [],
    interim: null, amplitude: 0, hint: null, clearHint: vi.fn(), errorMsg: null, clearError: vi.fn(), muted: false,
    setMuted: vi.fn(), pendingApproval: null, actionPending: false, approve: vi.fn(), deny: vi.fn(),
    start: voice.start, stop: voice.stop, interrupt: vi.fn(), submitExactText: vi.fn(async () => true),
    newConversation: vi.fn(), inputMode: "vad", setInputMode: vi.fn(), capturing: false, startPtt: vi.fn(),
    finishPtt: vi.fn(), togglePushToTalk: vi.fn(), voiceEngine: "openai", setVoiceEngine: vi.fn(),
  }),
}));
vi.mock("./useLiveVoice.js", () => ({ useLiveVoice: () => { throw new Error("not used in this test"); } }));
vi.mock("../design/face/FaceStill.js", () => ({ FaceStill: () => <span data-testid="still-face" /> }));
vi.mock("../design/face/FaceStage.js", () => ({ FaceStage: () => <div data-testid="live-face" /> }));

import { VoiceScreen } from "./VoiceScreen.js";

afterEach(() => { cleanup(); vi.clearAllMocks(); voice.engine = null; });

describe("VoiceScreen before the engine is known", () => {
  it("says it is connecting, opens nothing, then hands over to the voice screen", async () => {
    render(<VoiceScreen initialSessionId="s1" onExit={vi.fn()} onSwitchToKeyboard={vi.fn()} />);

    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Connecting");
    expect(screen.getByText("Connecting to voice…")).toBeTruthy();
    expect(screen.getByTestId("still-face")).toBeTruthy();
    expect(screen.queryByTestId("live-face")).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(voice.start).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "exit" })).toBeNull();

    await act(async () => { voice.engine!("openai"); });

    expect(voice.start).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "exit" })).toBeTruthy();
    expect(screen.queryByText("Connecting to voice…")).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });
});
