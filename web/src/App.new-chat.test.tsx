// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

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
    ChatScreen: () => {
      const mount = React.useRef(++state.nextChatMount);
      return <div data-testid="mock-chat">chat-{mount.current}</div>;
    },
  };
});

vi.mock("./rules/RulesScreen.js", () => ({ RulesScreen: () => null }));
vi.mock("./memory/MemoryScreen.js", () => ({ MemoryScreen: () => null }));
vi.mock("./self/SelfScreen.js", () => ({ SelfScreen: () => null }));
vi.mock("./orbit/OrbitScreen.js", () => ({ OrbitScreen: () => null }));
vi.mock("./orbit/ChatListScreen.js", () => ({ ChatListScreen: () => null }));
vi.mock("./voice/VoiceScreen.js", () => ({ VoiceScreen: () => null }));
vi.mock("./explorer/ExplorerScreen.js", () => ({ ExplorerScreen: () => null }));
vi.mock("./mission-control/MissionControlScreen.js", () => ({ MissionControlScreen: () => null }));
vi.mock("./strategy/StrategyRoomScreen.js", () => ({ StrategyRoomScreen: () => null }));

import { App } from "./App.js";

describe("App New-chat navigation", () => {
  beforeEach(() => { state.nextChatMount = 0; });

  it("mounts a clean ChatScreen every time New is pressed", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    expect(screen.getByTestId("mock-chat").textContent).toBe("chat-1");

    fireEvent.click(screen.getByRole("button", { name: "New" }));
    expect(screen.getByTestId("mock-chat").textContent).toBe("chat-2");
  });
});
