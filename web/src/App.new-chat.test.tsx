// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const state = vi.hoisted(() => ({ nextChatMount: 0 }));

vi.mock("./auth/tokens.js", () => ({ getToken: () => "paired" }));
vi.mock("./lib/useReducedMotion.js", () => ({ useReducedMotion: () => true }));
vi.mock("./lib/gsap.js", () => ({ Flip: { getState: () => null, from: () => {} } }));
vi.mock("./lib/deckMotion.js", () => ({
  SCREEN: { enter: 0, exit: 0, orb: 0, easeEnter: "linear", easeExit: "linear", from: {}, to: {}, exitTo: {} },
  markTransition: () => {},
}));
vi.mock("motion/react", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  const motion = new Proxy({}, {
    get: (_target, tag: string) => React.forwardRef<HTMLElement, Record<string, unknown>>(
      ({ children, initial: _initial, animate: _animate, exit: _exit, transition: _transition, ...props }, ref) =>
        React.createElement(tag, { ...props, ref }, children as React.ReactNode),
    ),
  });
  return {
    motion,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  };
});
vi.mock("./components/ava/TubelightNav.js", () => ({
  TubelightNav: ({ items }: { items: Array<{ name: string; onSelect: () => void }> }) => (
    <nav>{items.map((item) => <button key={item.name} onClick={item.onSelect}>{item.name}</button>)}</nav>
  ),
}));
vi.mock("./components/ava/GlassFilter.js", () => ({ GlassFilter: () => null }));
vi.mock("./auth/PairingScreen.js", () => ({ PairingScreen: () => null }));
vi.mock("./splash/Splash.js", () => ({ Splash: () => <div>Splash</div> }));
vi.mock("./chat/ChatScreen.js", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    ChatScreen: ({ onOpenStrategy, onOpenVisual, onEnterVoice }: {
      onOpenStrategy?: (sessionId: string) => void;
      onOpenVisual?: (visualId: string) => void;
      onEnterVoice?: (sessionId: string | null) => void;
    }) => {
      const mount = React.useRef(++state.nextChatMount);
      return (
        <div data-testid="mock-chat">
          chat-{mount.current}
          <button onClick={() => onOpenStrategy?.("internal-chat-17")}>mock take to room</button>
          <button onClick={() => onOpenVisual?.("visual_abcdefgh")}>mock open visual</button>
          <button onClick={() => onEnterVoice?.("internal-chat-17")}>mock enter voice</button>
          <button onClick={() => onEnterVoice?.(null)}>mock enter blank voice</button>
        </div>
      );
    },
  };
});

vi.mock("./rules/RulesScreen.js", () => ({ RulesScreen: () => null }));
vi.mock("./memory/MemoryScreen.js", () => ({ MemoryScreen: () => null }));
vi.mock("./self/SelfScreen.js", () => ({ SelfScreen: () => null }));
vi.mock("./orbit/OrbitScreen.js", () => ({
  OrbitScreen: ({ onEnterVoice }: { onEnterVoice?: () => void }) => (
    <button onClick={onEnterVoice}>mock home voice</button>
  ),
}));
vi.mock("./orbit/ChatListScreen.js", () => ({ ChatListScreen: () => null }));
vi.mock("./voice/VoiceScreen.js", () => ({
  VoiceScreen: ({ initialSessionId, startFresh }: { initialSessionId: string | null; startFresh?: boolean }) => (
    <div>voice-session-{initialSessionId ?? "none"}-fresh-{String(!!startFresh)}</div>
  ),
}));
vi.mock("./explorer/ExplorerScreen.js", () => ({ ExplorerScreen: () => null }));
vi.mock("./mission-control/MissionControlScreen.js", () => ({ MissionControlScreen: () => null }));
vi.mock("./strategy/StrategyRoomScreen.js", () => ({
  StrategyRoomScreen: ({ sourceSessionId, onOpenChat }: {
    sourceSessionId?: string | null;
    onOpenChat?: (sessionId: string) => void;
  }) => (
    <div>
      room-source-{sourceSessionId ?? "none"}
      <button onClick={() => sourceSessionId && onOpenChat?.(sourceSessionId)}>mock return to chat</button>
    </div>
  ),
}));
vi.mock("./visuals/VisualsScreen.js", () => ({
  VisualsScreen: ({ initialVisualId }: { initialVisualId?: string | null }) => <div>visual-id-{initialVisualId ?? "none"}</div>,
}));

import { App } from "./App.js";

describe("App New-chat navigation", () => {
  beforeEach(() => { state.nextChatMount = 0; });
  afterEach(cleanup);

  it("mounts a clean ChatScreen every time New is pressed", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    expect(screen.getByTestId("mock-chat").textContent).toContain("chat-1");

    fireEvent.click(screen.getByRole("button", { name: "New" }));
    expect(screen.getByTestId("mock-chat").textContent).toContain("chat-2");
  });

  it("carries the internal chat session into the Room and back", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    fireEvent.click(screen.getByRole("button", { name: "mock take to room" }));
    expect(screen.getByText("room-source-internal-chat-17")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "mock return to chat" }));
    expect(screen.getByTestId("mock-chat")).toBeTruthy();
  });

  it("opens the exact AVA visual emitted by the chat tool path", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    fireEvent.click(screen.getByRole("button", { name: "mock open visual" }));
    expect(screen.getByText("visual-id-visual_abcdefgh")).toBeTruthy();
  });

  it("hands voice the session ChatScreen actually created, not the stale null route value", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    fireEvent.click(screen.getByRole("button", { name: "mock enter voice" }));
    expect(screen.getByText("voice-session-internal-chat-17-fresh-false")).toBeTruthy();
  });

  it("marks voice entry from a blank New chat as a fresh conversation", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    fireEvent.click(screen.getByRole("button", { name: "mock enter blank voice" }));
    expect(screen.getByText("voice-session-none-fresh-true")).toBeTruthy();
  });

  it("keeps Home-orb voice entry on resume-latest behavior", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    fireEvent.click(screen.getByRole("button", { name: "mock home voice" }));
    expect(screen.getByText("voice-session-none-fresh-false")).toBeTruthy();
  });
});
