// AVA starts a conversation (contract ava-initiative): the push link opens
// the exact pair, the bar and Home open the newest idea, and the link is
// consumed so a reload never reopens it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const seen = vi.hoisted(() => ({ chat: [] as Array<Record<string, unknown>>, home: [] as Array<Record<string, unknown>> }));
const ideas = vi.hoisted(() => ({ fetchInitiativeSummary: vi.fn(), fetchInboxSessions: vi.fn() }));

vi.mock("./auth/tokens.js", () => ({ getToken: () => "paired" }));
vi.mock("./lib/useReducedMotion.js", () => ({ useReducedMotion: () => true }));
vi.mock("./lib/gsap.js", () => ({ Flip: { getState: () => null, from: () => {} } }));
vi.mock("./lib/deckMotion.js", () => ({
  SCREEN: { enter: 0, exit: 0, orb: 0, easeEnter: "linear", easeExit: "linear", from: {}, to: {}, exitTo: {} },
  markTransition: () => {},
}));
vi.mock("motion/react", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  const components = new Map<string, unknown>();
  const motion = new Proxy({}, {
    get: (_target, tag: string) => {
      if (!components.has(tag)) {
        components.set(tag, React.forwardRef<HTMLElement, Record<string, unknown>>(
          ({ children, initial: _initial, animate: _animate, exit: _exit, transition: _transition, ...props }, ref) =>
            React.createElement(tag, { ...props, ref }, children as React.ReactNode),
        ));
      }
      return components.get(tag);
    },
  });
  return { motion, AnimatePresence: ({ children }: { children: React.ReactNode }) => children };
});
vi.mock("./api.js", async () => ({
  ...(await vi.importActual<typeof import("./api.js")>("./api.js")),
  fetchSessionPage: async () => ({ sessions: [], nextCursor: null }),
}));
vi.mock("./initiative/api.js", async () => ({
  ...(await vi.importActual<typeof import("./initiative/api.js")>("./initiative/api.js")),
  fetchInitiativeSummary: (...args: unknown[]) => ideas.fetchInitiativeSummary(...args),
  fetchInboxSessions: (...args: unknown[]) => ideas.fetchInboxSessions(...args),
}));
vi.mock("./components/ava/GlassFilter.js", () => ({ GlassFilter: () => null }));
vi.mock("./auth/PairingScreen.js", () => ({ PairingScreen: () => null }));
vi.mock("./splash/Splash.js", () => ({ Splash: () => null }));
vi.mock("./chat/ChatScreen.js", () => ({
  ChatScreen: (props: Record<string, unknown>) => {
    seen.chat.push(props);
    return <div data-testid="mock-chat">chat-{String(props.sessionId)}-{String(props.initiativeId)}-{String(props.verifyInitiative)}</div>;
  },
}));
vi.mock("./home/HomeScreen.js", () => ({
  HomeScreen: (props: { ideas?: { pending: number; onOpen: () => void } | null }) => {
    seen.home.push(props);
    return (
      <div data-testid="mock-home">
        {props.ideas && <button type="button" onClick={props.ideas.onOpen}>home ideas {props.ideas.pending}</button>}
      </div>
    );
  },
}));
vi.mock("./today/TodayScreen.js", () => ({ TodayScreen: () => null }));
vi.mock("./rules/RulesScreen.js", () => ({ RulesScreen: () => null }));
vi.mock("./memory/MemoryScreen.js", () => ({ MemoryScreen: () => null }));
vi.mock("./self/SelfScreen.js", () => ({ SelfScreen: () => null }));

import { App, readIdeaLink } from "./App.js";

const SUMMARY = { pending: 2, unopened: 1, newest: { initiativeId: "ini_9", sessionId: "s_9", title: "Newest", publishedAt: 5 } };

beforeEach(() => {
  seen.chat.length = 0;
  seen.home.length = 0;
  ideas.fetchInitiativeSummary.mockReset();
  ideas.fetchInboxSessions.mockReset();
  sessionStorage.setItem("ava:splash-seen", "1");
  localStorage.setItem("ava:last-chat-session", "human_1");
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("readIdeaLink", () => {
  it("reads the exact pair from a push link", () => {
    expect(readIdeaLink("?session=s_1&initiative=ini_1")).toEqual({
      name: "chat", sessionId: "s_1", initiativeId: "ini_1", verifyInitiative: true,
    });
  });

  it("says a malformed idea link is unavailable instead of guessing", () => {
    expect(readIdeaLink("?initiative=ini_1")).toEqual({ name: "idea-missing" });
    expect(readIdeaLink("?session=a%2Fb&initiative=ini_1")).toEqual({ name: "idea-missing" });
  });

  it("ignores links that are not idea links", () => {
    expect(readIdeaLink("")).toBeNull();
    expect(readIdeaLink("?view=watches&from=mission-control")).toBeNull();
  });
});

describe("App with AVA's ideas", () => {
  it("opens a push link's exact pair, then forgets the link", async () => {
    ideas.fetchInitiativeSummary.mockResolvedValue({ pending: 0, unopened: 0, newest: null });
    window.history.replaceState(null, "", "/?session=s_1&initiative=ini_1");
    render(<App />);
    expect((await screen.findByTestId("mock-chat")).textContent).toBe("chat-s_1-ini_1-true");
    await waitFor(() => expect(window.location.search).toBe(""));
    expect(localStorage.getItem("ava:last-chat-session")).toBe("human_1");
  });

  it("says a malformed link's idea is unavailable in place", async () => {
    ideas.fetchInitiativeSummary.mockResolvedValue({ pending: 0, unopened: 0, newest: null });
    window.history.replaceState(null, "", "/?initiative=ini_1");
    render(<App />);
    expect((await screen.findByRole("alert")).textContent).toContain("This idea is no longer available.");
    expect(screen.queryByTestId("mock-chat")).toBeNull();
  });

  it("opens the newest idea from the bar's menu and from Home", async () => {
    ideas.fetchInitiativeSummary.mockResolvedValue(SUMMARY);
    render(<App />);
    const face = await screen.findByRole("button", { name: "Open menu, 2 ideas from AVA" });
    expect(document.querySelector<HTMLElement>("[data-idea-dot]")?.dataset.ideaDot).toBe("new");

    fireEvent.click(face);
    fireEvent.click(screen.getByRole("button", { name: /^2 ideas from AVA/ }));
    expect((await screen.findByTestId("mock-chat")).textContent).toBe("chat-s_9-ini_9-true");
    const chat = seen.chat.at(-1)!;
    expect(typeof chat.onFocusComposer).toBe("function");
    expect(typeof chat.onOpenInvitation).toBe("function");

    fireEvent.click(screen.getByRole("button", { name: "Open menu, 2 ideas from AVA" }));
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    fireEvent.click(await screen.findByRole("button", { name: "home ideas 2" }));
    expect((await screen.findByTestId("mock-chat")).textContent).toBe("chat-s_9-ini_9-true");
  });

  it("falls back to the inbox when the summary names no newest idea", async () => {
    ideas.fetchInitiativeSummary.mockResolvedValue({ pending: 1, unopened: 0, newest: null });
    ideas.fetchInboxSessions.mockResolvedValue([{ id: "s_4", initiativeId: "ini_4" }]);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "home ideas 1" }));
    expect((await screen.findByTestId("mock-chat")).textContent).toBe("chat-s_4-ini_4-true");
    expect(document.querySelector<HTMLElement>("[data-idea-dot]")?.dataset.ideaDot).toBe("seen");
  });

  it("shows nothing when AVA has no ideas feature or none are pending", async () => {
    ideas.fetchInitiativeSummary.mockRejectedValue(new Error("404"));
    render(<App />);
    await screen.findByTestId("mock-home");
    await waitFor(() => expect(ideas.fetchInitiativeSummary).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Open menu" })).toBeTruthy();
    expect(document.querySelector("[data-idea-dot]")).toBeNull();
    expect(seen.home.at(-1)?.ideas ?? null).toBeNull();
  });
});
