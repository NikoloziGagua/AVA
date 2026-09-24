// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const voice = vi.hoisted(() => ({
  pendingApproval: null as null | {
    id: string;
    tool: string;
    summary: string;
    riskTier: "medium" | "high";
    timeoutBehavior: "auto_approve" | "auto_deny";
    requestedAt: number;
    deadlineAt: number;
    timeoutMs: number;
  },
  approve: vi.fn(),
  deny: vi.fn(),
  start: vi.fn(),
}));

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
    setMuted: vi.fn(),
    pendingApproval: voice.pendingApproval,
    actionPending: false,
    approve: voice.approve,
    deny: voice.deny,
    start: voice.start,
    stop: vi.fn(),
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
vi.mock("../components/ava/DottedSurface.js", () => ({ DottedSurface: () => null }));
vi.mock("../lib/gsap.js", () => ({ gsap: { fromTo: vi.fn() }, useGSAP: vi.fn() }));
vi.mock("../lib/useReducedMotion.js", () => ({ useReducedMotion: () => true }));

import { RealtimeVoiceScreen as VoiceScreen } from "./VoiceScreen.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(200_000);
  voice.pendingApproval = {
    id: "voice-approval",
    tool: "fs_delete",
    summary: "Delete the disposable fixture",
    riskTier: "high",
    timeoutBehavior: "auto_deny",
    requestedAt: 200_000,
    deadlineAt: 215_000,
    timeoutMs: 15_000,
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("VoiceScreen approval policy copy", () => {
  it("announces high-risk auto-denial and keeps explicit controls operable", () => {
    render(<VoiceScreen initialSessionId="shared-session" onExit={vi.fn()} onSwitchToKeyboard={vi.fn()} />);

    const region = screen.getByRole("region", { name: "Approval required" });
    expect(region.textContent).toContain("High risk · Silence auto-denies");
    expect(screen.getByRole("status").textContent).toBe("Auto-denying in 15s — approve now to run.");
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(voice.deny).toHaveBeenCalledTimes(1);
    expect(voice.approve).toHaveBeenCalledTimes(1);
  });

  it("distinguishes the medium-risk auto-approve window", () => {
    voice.pendingApproval = {
      ...voice.pendingApproval!,
      tool: "claude_code",
      riskTier: "medium",
      timeoutBehavior: "auto_approve",
    };
    render(<VoiceScreen initialSessionId="shared-session" onExit={vi.fn()} onSwitchToKeyboard={vi.fn()} />);

    expect(screen.getByText(/Medium risk · Silence auto-approves/)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Auto-approving in 15s — cancel to stop.");
  });
});
