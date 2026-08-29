// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const submitExactText = vi.fn(async () => true);
const setMuted = vi.fn();
const start = vi.fn();

vi.mock("./useRealtimeVoice.js", () => ({
  useRealtimeVoice: () => ({
    state: "listening",
    sessionId: "shared-session",
    getSessionId: () => "shared-session",
    caption: null,
    turns: [],
    interim: null,
    amplitude: 0,
    hint: null,
    clearHint: vi.fn(),
    errorMsg: null,
    clearError: vi.fn(),
    muted: false,
    setMuted,
    pendingApproval: null,
    actionPending: false,
    approve: vi.fn(),
    deny: vi.fn(),
    start,
    stop: vi.fn(),
    interrupt: vi.fn(),
    submitExactText,
    newConversation: vi.fn(),
    inputMode: "vad",
    setInputMode: vi.fn(),
    capturing: false,
    startPtt: vi.fn(),
    finishPtt: vi.fn(),
    togglePushToTalk: vi.fn(),
    voiceEngine: "hume",
    setVoiceEngine: vi.fn(),
  }),
}));

vi.mock("../components/ava/Orb.js", () => ({ Orb: () => <div data-testid="orb" /> }));
vi.mock("../components/ava/MagicRings.js", () => ({ MagicRings: () => null }));
vi.mock("../components/ava/NebulaBackground.js", () => ({ NebulaBackground: () => null }));
vi.mock("../components/ava/DottedSurface.js", () => ({ DottedSurface: () => null }));
vi.mock("../lib/gsap.js", () => ({
  gsap: { fromTo: vi.fn() },
  useGSAP: vi.fn(),
}));
vi.mock("../lib/useReducedMotion.js", () => ({ useReducedMotion: () => true }));

import { VoiceScreen } from "./VoiceScreen.js";

beforeEach(() => {
  submitExactText.mockClear().mockResolvedValue(true);
  setMuted.mockClear();
  start.mockClear();
});
afterEach(() => cleanup());

describe("VoiceScreen exact-text integration", () => {
  it("opens inside voice, pauses/restores the mic, submits, and returns focus", async () => {
    render(<VoiceScreen initialSessionId="shared-session" onExit={vi.fn()} onSwitchToKeyboard={vi.fn()} />);
    expect(start).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Hume EVI voice").textContent).toContain("HUME");

    const trigger = screen.getByRole("button", { name: "type exact text in voice" });
    fireEvent.click(trigger);
    expect(setMuted).toHaveBeenCalledWith(true);
    expect(screen.getByText("Typing exact wording · nothing sent yet")).toBeTruthy();

    const exact = "@Exact_Name?q=A_B%20C";
    fireEvent.change(screen.getByLabelText("Exact wording"), { target: { value: exact } });
    fireEvent.click(screen.getByRole("button", { name: "Send to AVA" }));
    await waitFor(() => expect(submitExactText).toHaveBeenCalledWith(exact));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(setMuted).toHaveBeenLastCalledWith(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("is a narrow-width-safe modal with no auto-submit on open", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
    render(<VoiceScreen initialSessionId="shared-session" onExit={vi.fn()} onSwitchToKeyboard={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "type exact text in voice" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("w-[calc(100vw-1.5rem)]");
    expect(submitExactText).not.toHaveBeenCalled();
  });
});
