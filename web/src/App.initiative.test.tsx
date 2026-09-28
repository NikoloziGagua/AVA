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
type ChatProps = {
  sessionId: string | null;
  initiativeId?: string | null;
  verifyInitiative?: boolean;
  onOpenInvitation?: (target: { sessionId: string; initiativeId: string }) => void;
  onEnterVoice?: (sessionId: string | null) => void;
  onSessionChange?: (sessionId: string) => void;
};
vi.mock("./chat/ChatScreen.js", () => ({
  ChatScreen: (props: ChatProps) => {
    seen.chat.push(props as unknown as Record<string, unknown>);
    return (
      <div data-testid="mock-chat">
        <span data-testid="chat-route">chat-{String(props.sessionId)}-{String(props.initiativeId)}-{String(props.verifyInitiative)}</span>
        <button type="button" onClick={() => props.onOpenInvitation?.({ sessionId: "s_3", initiativeId: "ini_3" })}>mock older idea</button>
        <button type="button" onClick={() => props.onEnterVoice?.(props.sessionId)}>mock voice</button>
        <button type="button" onClick={() => props.sessionId && props.onSessionChange?.(props.sessionId)}>mock reply</button>
      </div>
    );
  },
}));
vi.mock("./voice/VoiceScreen.js", () => ({
  VoiceScreen: (props: { initialSessionId: string | null; intent: string; onSessionBound: (id: string) => void; onExit: (id: string | null) => void }) => (
    <div data-testid="mock-voice">
      <span data-testid="voice-route">voice-{String(props.initialSessionId)}-{props.intent}</span>
      <button type="button" onClick={() => props.initialSessionId && props.onSessionBound(props.initialSessionId)}>mock voice ack</button>
      <button type="button" onClick={() => props.onExit(props.initialSessionId)}>mock voice exit</button>
    </div>
  ),
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
  sessionStorage.removeItem("ava:open-idea");
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
  it("opens a push link's exact pair and consumes the link; a reload returns to that idea, not the old chat", async () => {
    ideas.fetchInitiativeSummary.mockResolvedValue({ pending: 0, unopened: 0, newest: null });
    window.history.replaceState(null, "", "/?session=s_1&initiative=ini_1");
    render(<App />);
    expect((await screen.findByTestId("chat-route")).textContent).toBe("chat-s_1-ini_1-true");
    await waitFor(() => expect(window.location.search).toBe(""));
    expect(localStorage.getItem("ava:last-chat-session")).toBe("human_1");

    cleanup();
    render(<App />);
    expect((await screen.findByTestId("chat-route")).textContent).toBe("chat-s_1-ini_1-true");
    expect(window.location.search).toBe("");
    expect(localStorage.getItem("ava:last-chat-session")).toBe("human_1");
  });

  it("forgets the open idea once Niko leaves it, so a later reload lands on Home", async () => {
    ideas.fetchInitiativeSummary.mockResolvedValue(SUMMARY);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "home ideas 2" }));
    expect((await screen.findByTestId("chat-route")).textContent).toBe("chat-s_9-ini_9-true");
    fireEvent.click(screen.getByRole("button", { name: "Open menu, 2 ideas from AVA" }));
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    await screen.findByTestId("mock-home");

    cleanup();
    render(<App />);
    await screen.findByTestId("mock-home");
    expect(screen.queryByTestId("mock-chat")).toBeNull();
    expect(localStorage.getItem("ava:last-chat-session")).toBe("human_1");
  });

  it("keeps what Niko typed on an idea that is not confirmed, until he chooses a new chat", async () => {
    ideas.fetchInitiativeSummary.mockResolvedValue({ pending: 0, unopened: 0, newest: null });
    window.history.replaceState(null, "", "/?initiative=ini_1");
    render(<App />);
    await screen.findByRole("alert");
    // Voice cannot fall through to the old chat either.
    expect(screen.queryByRole("button", { name: "Talk to AVA" })).toBeNull();

    const box = screen.getByRole("textbox", { name: "Message AVA" }) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "hello" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(screen.getByRole("alert").textContent).toContain("This idea is no longer available.");
    expect(box.value).toBe("hello");
    expect(screen.queryByTestId("mock-chat")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Start a new conversation" }));
    expect((await screen.findByTestId("chat-route")).textContent).toBe("chat-null-null-false");
    expect((screen.getByRole("textbox", { name: "Message AVA" }) as HTMLTextAreaElement).value).toBe("hello");
  });

  it("holds the draft on a link that is still being checked, instead of starting another chat", async () => {
    ideas.fetchInitiativeSummary.mockResolvedValue({ pending: 0, unopened: 0, newest: null });
    window.history.replaceState(null, "", "/?session=s_1&initiative=ini_1");
    render(<App />);
    expect((await screen.findByTestId("chat-route")).textContent).toBe("chat-s_1-ini_1-true");
    const box = screen.getByRole("textbox", { name: "Message AVA" }) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "is this about Acme?" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(screen.getByTestId("chat-route").textContent).toBe("chat-s_1-ini_1-true");
    expect(box.value).toBe("is this about Acme?");
  });

  it("keeps the remembered chat while Niko moves between ideas, until voice binds one", async () => {
    ideas.fetchInitiativeSummary.mockResolvedValue(SUMMARY);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Open menu, 2 ideas from AVA" }));
    fireEvent.click(screen.getByRole("button", { name: /^2 ideas from AVA/ }));
    expect((await screen.findByTestId("chat-route")).textContent).toBe("chat-s_9-ini_9-true");

    fireEvent.click(screen.getByRole("button", { name: "mock older idea" }));
    await waitFor(() => expect(screen.getByTestId("chat-route").textContent).toBe("chat-s_3-ini_3-true"));
    expect(localStorage.getItem("ava:last-chat-session")).toBe("human_1");

    // Voice from an idea binds that exact conversation; only its acknowledgement moves the pointer.
    fireEvent.click(screen.getByRole("button", { name: "mock voice" }));
    expect((await screen.findByTestId("voice-route")).textContent).toBe("voice-s_3-resume");
    expect(localStorage.getItem("ava:last-chat-session")).toBe("human_1");
    fireEvent.click(screen.getByRole("button", { name: "mock voice ack" }));
    expect(localStorage.getItem("ava:last-chat-session")).toBe("s_3");

    fireEvent.click(screen.getByRole("button", { name: "mock voice exit" }));
    expect((await screen.findByTestId("chat-route")).textContent).toBe("chat-s_3-null-false");
  });

  it("lets the first reply select the idea's conversation", async () => {
    ideas.fetchInitiativeSummary.mockResolvedValue(SUMMARY);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "home ideas 2" }));
    expect((await screen.findByTestId("chat-route")).textContent).toBe("chat-s_9-ini_9-true");
    expect(localStorage.getItem("ava:last-chat-session")).toBe("human_1");
    fireEvent.click(screen.getByRole("button", { name: "mock reply" }));
    expect(localStorage.getItem("ava:last-chat-session")).toBe("s_9");
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
    expect((await screen.findByTestId("chat-route")).textContent).toBe("chat-s_9-ini_9-true");
    const chat = seen.chat.at(-1)!;
    expect(typeof chat.onFocusComposer).toBe("function");
    expect(typeof chat.onOpenInvitation).toBe("function");

    fireEvent.click(screen.getByRole("button", { name: "Open menu, 2 ideas from AVA" }));
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    fireEvent.click(await screen.findByRole("button", { name: "home ideas 2" }));
    expect((await screen.findByTestId("chat-route")).textContent).toBe("chat-s_9-ini_9-true");
  });

  it("falls back to the inbox when the summary names no newest idea", async () => {
    ideas.fetchInitiativeSummary.mockResolvedValue({ pending: 1, unopened: 0, newest: null });
    ideas.fetchInboxSessions.mockResolvedValue([{ id: "s_4", initiativeId: "ini_4" }]);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "home ideas 1" }));
    expect((await screen.findByTestId("chat-route")).textContent).toBe("chat-s_4-ini_4-true");
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
