// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const state = vi.hoisted(() => ({ chatLoads: 0, visualLoads: 0 }));

vi.mock("./auth/tokens.js", () => ({ getToken: () => "paired" }));
vi.mock("./lib/useReducedMotion.js", () => ({ useReducedMotion: () => true }));
vi.mock("./lib/gsap.js", () => ({ Flip: { getState: () => null, from: () => {} } }));
vi.mock("./lib/deckMotion.js", () => ({
  SCREEN: { enter: 0, exit: 0, orb: 0, easeEnter: "linear", easeExit: "linear", from: {}, to: {}, exitTo: {} },
  markTransition: () => {},
}));
vi.mock("motion/react", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  // One stable component per tag, like the real library. Minting a new
  // component on every `motion.div` access made React remount each route on
  // every App re-render, so a late 40ms transition timer could detach the very
  // button a test was about to click (a test-only flake, not a product race).
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
  return {
    motion,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  };
});
// The real sidebar renders; its recent-chats lookup must not reach the network.
vi.mock("./api.js", async () => ({
  ...(await vi.importActual<typeof import("./api.js")>("./api.js")),
  fetchSessionPage: async () => ({ sessions: [], nextCursor: null }),
}));
vi.mock("./components/ava/GlassFilter.js", () => ({ GlassFilter: () => null }));
vi.mock("./auth/PairingScreen.js", () => ({ PairingScreen: () => null }));
vi.mock("./splash/Splash.js", () => ({
  Splash: ({ onDone }: { onDone: () => void }) => <div>Splash<button onClick={onDone}>mock splash done</button></div>,
}));
vi.mock("./chat/ChatScreen.js", async () => {
  state.chatLoads += 1;
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    ChatScreen: ({ sessionId, initialText, audit, onOpenStrategy, onOpenVisual, onEnterVoice, onSessionChange }: {
      sessionId?: string | null;
      initialText?: string;
      audit?: boolean;
      onOpenStrategy?: (sessionId: string) => void;
      onOpenVisual?: (visualId: string) => void;
      onEnterVoice?: (sessionId: string | null) => void;
      onSessionChange?: (sessionId: string) => void;
    }) => {
      const [draftRevision, setDraftRevision] = React.useState(0);
      return (
        <div data-testid="mock-chat">
          session-{sessionId ?? "new"}-draft-{draftRevision}-audit-{String(!!audit)}
          <span>initial-{initialText ?? "none"}</span>
          <button onClick={() => setDraftRevision((value) => value + 1)}>mock change draft</button>
          <button onClick={() => onSessionChange?.("internal-chat-17")}>mock establish session</button>
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
vi.mock("./today/TodayScreen.js", () => ({
  TodayScreen: ({ onEnterVoice, onStartChat, onOpenNote, onOpenTalk }: {
    onEnterVoice?: () => void;
    onStartChat?: (text: string) => void;
    onOpenNote?: (noteId: string) => void;
    onOpenTalk?: () => void;
  }) => (
    <div data-testid="mock-today">
      <button onClick={onEnterVoice}>mock today voice</button>
      <button onClick={() => onStartChat?.("open exact project")}>mock today command</button>
      <button onClick={() => onOpenNote?.("note-7")}>mock today note</button>
      <button onClick={onOpenTalk}>mock today conversations</button>
    </div>
  ),
}));
vi.mock("./notes/NotesScreen.js", () => ({
  NotesScreen: ({ initialNoteId }: { initialNoteId?: string | null }) => <div>notes-initial-{initialNoteId ?? "none"}</div>,
}));
vi.mock("./ideas/IdeasScreen.js", () => ({
  IdeasScreen: ({ onOpenNote }: { onOpenNote: (noteId: string) => void }) => (
    <div>ideas-screen<button onClick={() => onOpenNote("idea-3")}>mock open idea</button></div>
  ),
}));
vi.mock("./schedule/ScheduleScreen.js", () => ({
  ScheduleScreen: ({ onOpenTalk }: { onOpenTalk: () => void }) => (
    <div>schedule-screen<button onClick={onOpenTalk}>mock schedule talk</button></div>
  ),
}));
vi.mock("./orbit/ChatListScreen.js", () => ({ ChatListScreen: () => <div>chat-list-screen</div> }));
vi.mock("./voice/VoiceScreen.js", () => ({
  VoiceScreen: ({ initialSessionId, intent, onSessionBound, onSessionUnavailable, onExit }: {
    initialSessionId: string | null;
    intent?: string;
    onSessionBound?: (sessionId: string) => void;
    onSessionUnavailable?: () => void;
    onExit?: (sessionId: string | null) => void;
  }) => (
    <div>
      voice-session-{initialSessionId ?? "none"}-intent-{intent ?? "default"}
      <button onClick={() => onSessionBound?.("voice-bound-5")}>mock voice bound</button>
      <button onClick={() => onSessionUnavailable?.()}>mock voice unavailable</button>
      <button onClick={() => onExit?.("voice-bound-5")}>mock voice exit</button>
    </div>
  ),
}));
vi.mock("./explorer/ExplorerScreen.js", () => ({ ExplorerScreen: () => <div>explorer-workspace</div> }));
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
vi.mock("./visuals/VisualsScreen.js", () => {
  state.visualLoads += 1;
  return {
    VisualsScreen: ({ initialVisualId }: { initialVisualId?: string | null }) => (
      <div>visual-id-{initialVisualId ?? "none"}</div>
    ),
  };
});
vi.mock("./watches/WatchesScreen.js", () => ({
  WatchesScreen: ({ focusWatchId, navigationRequested, onOpenChat }: {
    focusWatchId?: string | null;
    navigationRequested?: boolean;
    onOpenChat?: (sessionId: string) => void;
  }) => (
    <div>
      watch-management-screen
      <button onClick={() => onOpenChat?.("watch-run-9")}>mock open watch run</button>
      <span>focus-{focusWatchId ?? "none"}</span>
      <span>origin-{String(!!navigationRequested)}</span>
    </div>
  ),
}));

import { App, DeferredScreenBoundary, DeferredScreenFallback } from "./App.js";

// Voice is a lazily loaded route; under a busy full-suite run its first import
// can take longer than the default one-second lookup.
const LAZY_ROUTE = { timeout: 5000 };

function BrokenWorkspace(): never {
  throw new Error("chunk unavailable");
}

/** Opens the System group; the compact rail expands onto it. */
function openSystem() {
  if (!screen.queryByRole("group", { name: "System tools" })) {
    fireEvent.click(screen.getByRole("button", { name: "System" }));
  }
  return screen.getByRole("group", { name: "System tools" });
}

describe("App navigation", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    // The intro has already played in this tab; the splash tests clear this.
    window.sessionStorage.setItem("ava:splash-seen", "1");
    window.history.replaceState(null, "", "/");
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("does not load Chat or Visuals for the initial shell", () => {
    window.sessionStorage.clear();
    render(<App />);
    expect(screen.getByText("Splash")).toBeTruthy();
    expect(state.chatLoads).toBe(0);
    expect(state.visualLoads).toBe(0);
    expect(document.querySelector(".ava-sidebar")?.getAttribute("data-expanded")).toBeNull();
  });

  it("plays the intro once per tab and then lands on Today", () => {
    window.sessionStorage.clear();
    const first = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "mock splash done" }));
    expect(screen.getByTestId("mock-today")).toBeTruthy();
    expect(window.sessionStorage.getItem("ava:splash-seen")).toBe("1");
    first.unmount();
    render(<App />);
    expect(screen.queryByText("Splash")).toBeNull();
    expect(screen.getByTestId("mock-today")).toBeTruthy();
  });

  it("skips the intro under AVA's reduced-motion setting", () => {
    window.sessionStorage.clear();
    window.localStorage.setItem("ava-motion", "reduced");
    render(<App />);
    expect(screen.queryByText("Splash")).toBeNull();
    expect(screen.getByTestId("mock-today")).toBeTruthy();
  });

  it("opens on Today and reaches every everyday destination", async () => {
    render(<App />);
    expect(screen.getByTestId("mock-today")).toBeTruthy();
    expect(document.querySelector('[data-view="today"]')).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Talk" }));
    expect(screen.getByText("chat-list-screen")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
    expect(screen.getByText("schedule-screen")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Notes" }));
    expect(screen.getByText("notes-initial-none")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ideas" }));
    expect(screen.getByText("ideas-screen")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    expect((await screen.findByTestId("mock-chat")).textContent).toContain("session-new");
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByTestId("mock-today")).toBeTruthy();
  });

  it("keeps every previous destination under System, plus Activity", async () => {
    render(<App />);
    const group = openSystem();
    const labels = Array.from(group.querySelectorAll("button")).map((button) => button.getAttribute("aria-label"));
    expect(labels).toEqual([
      "Activity", "Explore AVA", "Watches", "Memory", "Strategy Room",
      "Visual explanations", "Settings & rules", "Self development",
    ]);

    const destinations: Array<[string, string]> = [
      ["Explore AVA", "capabilities"],
      ["Watches", "watches"],
      ["Memory", "memory"],
      ["Strategy Room", "strategy"],
      ["Visual explanations", "visuals"],
      ["Settings & rules", "rules"],
      ["Self development", "self"],
    ];
    for (const [label, view] of destinations) {
      fireEvent.click(within(openSystem()).getByRole("button", { name: label }));
      // Explore, Memory and Visuals are lazy routes.
      await waitFor(() => expect(document.querySelector(`[data-view="${view}"]`), label).toBeTruthy(), LAZY_ROUTE);
    }
  });

  it("opens Activity as Mission Control without leaving the current screen", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<App />);
    fireEvent.click(within(openSystem()).getByRole("button", { name: "Activity" }));
    expect(open).toHaveBeenCalledWith("/?mission-control=1", "ava-mission-control", expect.any(String));
    expect(screen.getByTestId("mock-today")).toBeTruthy();
  });

  it("exposes accessible loading and reload recovery states", async () => {
    const reload = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const fallback = render(<DeferredScreenFallback />);
    expect(screen.getByRole("status").textContent).toContain("Loading workspace");
    fallback.unmount();

    const view = render(
      <DeferredScreenBoundary resetKey="chat" reload={reload}>
        <BrokenWorkspace />
      </DeferredScreenBoundary>,
    );
    expect(screen.getByRole("alert").textContent).toContain("did not load");
    fireEvent.click(screen.getByRole("button", { name: "Reload AVA" }));
    expect(reload).toHaveBeenCalledTimes(1);
    view.rerender(
      <DeferredScreenBoundary resetKey="today" reload={reload}>
        <div>recovered workspace</div>
      </DeferredScreenBoundary>,
    );
    expect(await screen.findByText("recovered workspace")).toBeTruthy();
    consoleError.mockRestore();
  });

  it("mounts a clean ChatScreen every time New is pressed", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    await screen.findByTestId("mock-chat");
    fireEvent.click(screen.getByRole("button", { name: "mock change draft" }));
    expect(screen.getByTestId("mock-chat").textContent).toContain("draft-1");

    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    await waitFor(() => expect(screen.getByTestId("mock-chat").textContent).toContain("draft-0"));
  });

  it("carries text typed on Today into a new chat", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "mock today command" }));
    expect((await screen.findByTestId("mock-chat")).textContent).toContain("initial-open exact project");
  });

  it("opens the exact note chosen on Today or in Ideas", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "mock today note" }));
    expect(screen.getByText("notes-initial-note-7")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ideas" }));
    fireEvent.click(screen.getByRole("button", { name: "mock open idea" }));
    expect(screen.getByText("notes-initial-idea-3")).toBeTruthy();
  });

  it("unmounts Today before another workspace is presented", async () => {
    render(<App />);
    expect(screen.getByRole("button", { name: "mock today command" })).toBeTruthy();
    fireEvent.click(within(openSystem()).getByRole("button", { name: "Explore AVA" }));
    expect(await screen.findByText("explorer-workspace")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "mock today command" })).toBeNull();
    expect(document.querySelectorAll("[data-view]")).toHaveLength(1);
    expect(document.querySelector('[data-view="capabilities"]')).toBeTruthy();
  });

  it("carries the internal chat session into the Room and back", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    await screen.findByTestId("mock-chat");
    fireEvent.click(screen.getByRole("button", { name: "mock take to room" }));
    expect(screen.getByText("room-source-internal-chat-17")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "mock return to chat" }));
    expect(screen.getByTestId("mock-chat")).toBeTruthy();
  });

  it("opens the exact AVA visual emitted by the chat tool path", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    await screen.findByTestId("mock-chat");
    fireEvent.click(screen.getByRole("button", { name: "mock open visual" }));
    expect(await screen.findByText("visual-id-visual_abcdefgh")).toBeTruthy();
  });

  it("hands voice the session ChatScreen actually created, not the stale null route value", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    await screen.findByTestId("mock-chat");
    fireEvent.click(screen.getByRole("button", { name: "mock enter voice" }));
    expect(await screen.findByText(/voice-session-internal-chat-17-intent-resume/, undefined, LAZY_ROUTE)).toBeTruthy();
  });

  it("marks voice entry from a blank New chat as a fresh conversation", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    await screen.findByTestId("mock-chat");
    fireEvent.click(screen.getByRole("button", { name: "mock enter blank voice" }));
    expect(await screen.findByText(/voice-session-none-intent-new/, undefined, LAZY_ROUTE)).toBeTruthy();
  });

  it("lets Today voice continue Nika's latest conversation when none is remembered", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "mock today voice" }));
    expect(await screen.findByText(/voice-session-none-intent-continue/, undefined, LAZY_ROUTE)).toBeTruthy();
  });

  it("sends Today voice back to the exact remembered conversation", async () => {
    window.localStorage.setItem("ava:last-chat-session", "remembered-8");
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "mock today voice" }));
    expect(await screen.findByText(/voice-session-remembered-8-intent-resume/, undefined, LAZY_ROUTE)).toBeTruthy();
  });

  it("moves the current chat to the conversation voice actually bound", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "mock today voice" }));
    fireEvent.click(await screen.findByRole("button", { name: "mock voice bound" }, LAZY_ROUTE));
    expect(window.localStorage.getItem("ava:last-chat-session")).toBe("voice-bound-5");
    fireEvent.click(screen.getByRole("button", { name: "mock voice exit" }));
    expect(screen.getByTestId("mock-today")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Talk" }));
    expect((await screen.findByTestId("mock-chat")).textContent).toContain("session-voice-bound-5");
  });

  it("forgets the remembered chat only when voice finds that exact one unavailable", async () => {
    window.localStorage.setItem("ava:last-chat-session", "gone-2");
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "mock today voice" }));
    fireEvent.click(await screen.findByRole("button", { name: "mock voice unavailable" }, LAZY_ROUTE));
    expect(window.localStorage.getItem("ava:last-chat-session")).toBeNull();
  });

  it("forgets the conversation Today voice bound when that one becomes unavailable", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "mock today voice" }));
    fireEvent.click(await screen.findByRole("button", { name: "mock voice bound" }, LAZY_ROUTE));
    expect(window.localStorage.getItem("ava:last-chat-session")).toBe("voice-bound-5");
    fireEvent.click(screen.getByRole("button", { name: "mock voice unavailable" }));
    expect(window.localStorage.getItem("ava:last-chat-session")).toBeNull();
  });

  it("forgets the new conversation voice moved to, not the one it was entered with", async () => {
    window.localStorage.setItem("ava:last-chat-session", "remembered-8");
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "mock today voice" }));
    fireEvent.click(await screen.findByRole("button", { name: "mock voice bound" }, LAZY_ROUTE));
    fireEvent.click(screen.getByRole("button", { name: "mock voice unavailable" }));
    expect(window.localStorage.getItem("ava:last-chat-session")).toBeNull();
  });

  it("never lets an earlier voice visit's binding decide what a later visit forgets", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "mock today voice" }));
    fireEvent.click(await screen.findByRole("button", { name: "mock voice bound" }, LAZY_ROUTE));
    fireEvent.click(screen.getByRole("button", { name: "mock voice exit" }));
    // A different conversation becomes current, then a new voice visit finds it
    // unavailable before binding anything.
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    fireEvent.click(await screen.findByRole("button", { name: "mock establish session" }));
    expect(window.localStorage.getItem("ava:last-chat-session")).toBe("internal-chat-17");
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    fireEvent.click(screen.getByRole("button", { name: "mock today voice" }));
    expect(await screen.findByText(/voice-session-internal-chat-17-intent-resume/, undefined, LAZY_ROUTE)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "mock voice unavailable" }));
    expect(window.localStorage.getItem("ava:last-chat-session")).toBeNull();
  });

  it("does not play the intro after a reduced-motion first load switches to full motion", () => {
    window.sessionStorage.clear();
    window.localStorage.setItem("ava-motion", "reduced");
    const first = render(<App />);
    expect(screen.getByTestId("mock-today")).toBeTruthy();
    first.unmount();
    window.localStorage.removeItem("ava-motion");
    render(<App />);
    expect(screen.queryByText("Splash")).toBeNull();
    expect(screen.getByTestId("mock-today")).toBeTruthy();
  });

  it("does not play the intro on a reload after a deep-linked first load", () => {
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/?view=watches&watch=watch_Exact-7&from=mission-control");
    const first = render(<App />);
    expect(screen.getByText("watch-management-screen")).toBeTruthy();
    first.unmount();
    window.history.replaceState(null, "", "/");
    render(<App />);
    expect(screen.queryByText("Splash")).toBeNull();
    expect(screen.getByTestId("mock-today")).toBeTruthy();
  });

  it("opens a watch run for reference without making it the current chat", async () => {
    window.localStorage.setItem("ava:last-chat-session", "mine-1");
    render(<App />);
    fireEvent.click(within(openSystem()).getByRole("button", { name: "Watches" }));
    fireEvent.click(screen.getByRole("button", { name: "mock open watch run" }));
    expect((await screen.findByTestId("mock-chat")).textContent).toContain("session-watch-run-9-draft-0-audit-true");
    expect(window.localStorage.getItem("ava:last-chat-session")).toBe("mine-1");
  });

  it("lands an exact Mission Control deep link in Watches and consumes the URL", () => {
    window.history.replaceState(null, "", "/?view=watches&watch=watch_Exact-7&from=mission-control");
    render(<App />);
    expect(screen.getByText("watch-management-screen")).toBeTruthy();
    expect(screen.getByText("focus-watch_Exact-7")).toBeTruthy();
    expect(screen.getByText("origin-true")).toBeTruthy();
    expect(window.location.search).toBe("");
  });

  it("keeps a malformed Mission Control watcher link non-identifying", () => {
    window.history.replaceState(null, "", "/?view=watches&watch=..%2Fsecret&from=mission-control");
    render(<App />);
    expect(screen.getByText("watch-management-screen")).toBeTruthy();
    expect(screen.getByText("focus-none")).toBeTruthy();
    expect(screen.getByText("origin-true")).toBeTruthy();
  });

  it("Talk returns directly to the same chat after visiting another workspace", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    await screen.findByTestId("mock-chat");
    fireEvent.click(screen.getByRole("button", { name: "mock establish session" }));
    fireEvent.click(within(openSystem()).getByRole("button", { name: "Explore AVA" }));
    fireEvent.click(screen.getByRole("button", { name: "Talk" }));
    expect((await screen.findByTestId("mock-chat")).textContent).toContain("session-internal-chat-17");
  });

  it("Talk restores the remembered chat after an application reload", async () => {
    window.localStorage.setItem("ava:last-chat-session", "persisted-chat-42");
    const first = render(<App />);
    first.unmount();
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Talk" }));
    expect((await screen.findByTestId("mock-chat")).textContent).toContain("session-persisted-chat-42");
  });

  it("Schedule's only action goes to Talk", async () => {
    window.localStorage.setItem("ava:last-chat-session", "persisted-chat-42");
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
    fireEvent.click(screen.getByRole("button", { name: "mock schedule talk" }));
    expect((await screen.findByTestId("mock-chat")).textContent).toContain("session-persisted-chat-42");
  });
});
