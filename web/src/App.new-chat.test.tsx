// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const state = vi.hoisted(() => ({ chatLoads: 0, visualLoads: 0, chatMounts: [] as string[], talkSends: [] as string[], talkStops: 0 }));

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
// The real bottom bar renders; its recent-chats lookup must not reach the network.
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
    ChatScreen: ({ sessionId, initialText, audit, onOpenStrategy, onOpenVisual, onEnterVoice, onSessionChange, onOpenSaved, onComposer, onDraft }: {
      sessionId?: string | null;
      initialText?: string;
      audit?: boolean;
      onOpenStrategy?: (sessionId: string) => void;
      onOpenVisual?: (visualId: string) => void;
      onEnterVoice?: (sessionId: string | null) => void;
      onSessionChange?: (sessionId: string) => void;
      onOpenSaved?: (item: { kind: "note" | "idea" | "reminder" | "watch" | "memory"; id: string; title: string }) => void;
      onComposer?: (bar: { onSend: (text: string) => void; busy: boolean; onStop: () => void; onVoice: () => void } | null) => void;
      onDraft?: (text: string) => void;
    }) => {
      const [draftRevision, setDraftRevision] = React.useState(0);
      const [busy, setBusy] = React.useState(false);
      // Like the real screen: lend the bar this conversation unless it is read-only.
      React.useEffect(() => {
        if (audit) return;
        onComposer?.({
          onSend: (text) => { state.talkSends.push(text); },
          busy,
          onStop: () => { state.talkStops += 1; },
          onVoice: () => onEnterVoice?.("internal-chat-17"),
        });
        return () => onComposer?.(null);
      }, [audit, busy]);
      // Each mount is one conversation start; a real ChatScreen sends initialText once per mount.
      React.useEffect(() => { state.chatMounts.push(initialText ?? ""); }, []);
      return (
        <div data-testid="mock-chat">
          session-{sessionId ?? "new"}-draft-{draftRevision}-audit-{String(!!audit)}
          <span>initial-{initialText ?? "none"}</span>
          <button onClick={() => setDraftRevision((value) => value + 1)}>mock change draft</button>
          <button onClick={() => setBusy((value) => !value)}>mock toggle busy</button>
          <button onClick={() => onDraft?.("words given back")}>mock give words back</button>
          <button onClick={() => onSessionChange?.("internal-chat-17")}>mock establish session</button>
          <button onClick={() => onOpenStrategy?.("internal-chat-17")}>mock take to room</button>
          <button onClick={() => onOpenVisual?.("visual_abcdefgh")}>mock open visual</button>
          <button onClick={() => onEnterVoice?.("internal-chat-17")}>mock enter voice</button>
          <button onClick={() => onEnterVoice?.(null)}>mock enter blank voice</button>
          <button onClick={() => onOpenSaved?.({ kind: "idea", id: "idea-saved-1", title: "Kiln" })}>mock open saved idea</button>
          <button onClick={() => onOpenSaved?.({ kind: "reminder", id: "w-rem-1", title: "Clothes" })}>mock open saved reminder</button>
          <button onClick={() => onOpenSaved?.({ kind: "watch", id: "w-watch-2", title: "Inbox" })}>mock open saved watch</button>
          <button onClick={() => onOpenSaved?.({ kind: "memory", id: "file:preferences", title: "Tea" })}>mock open saved memory</button>
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
vi.mock("./home/HomeScreen.js", () => ({
  HomeScreen: ({ onStartChat, onOpenNote }: { onStartChat?: (text: string) => void; onOpenNote?: (noteId: string) => void }) => (
    <div data-testid="mock-home">
      <button onClick={() => onStartChat?.("open exact project")}>mock home command</button>
      <button onClick={() => onOpenNote?.("note-7")}>mock home note</button>
    </div>
  ),
}));
vi.mock("./design/face/FaceStill.js", () => ({ FaceStill: () => null }));
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
vi.mock("./mission-control/MissionControlScreen.js", () => ({ MissionControlScreen: () => <div>mission-control-screen</div> }));
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

/** Opens the bottom-bar menu if it is closed and returns it. */
function openMenu(): HTMLElement {
  const toggle = screen.queryByRole("button", { name: "Open menu" });
  if (toggle) fireEvent.click(toggle);
  return document.querySelector<HTMLElement>('[role="dialog"][aria-label="Menu"]')!;
}

/** Chooses a destination from the bottom-bar menu. */
function go(label: string) {
  fireEvent.click(within(openMenu()).getByRole("button", { name: label }));
}

describe("App navigation", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    // The intro has already played in this tab; the splash tests clear this.
    window.sessionStorage.setItem("ava:splash-seen", "1");
    state.talkSends = [];
    state.talkStops = 0;
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
    // The intro is immersive: no bottom bar yet.
    expect(screen.queryByRole("navigation", { name: "AVA" })).toBeNull();
  });

  it("plays the intro once per tab and then lands on Home", () => {
    window.sessionStorage.clear();
    const first = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "mock splash done" }));
    expect(document.querySelector('[data-view="home"]')).toBeTruthy();
    expect(window.sessionStorage.getItem("ava:splash-seen")).toBe("1");
    first.unmount();
    render(<App />);
    expect(screen.queryByText("Splash")).toBeNull();
    expect(screen.getByTestId("mock-home")).toBeTruthy();
  });

  it("skips the intro under AVA's reduced-motion setting", () => {
    window.sessionStorage.clear();
    window.localStorage.setItem("ava-motion", "reduced");
    render(<App />);
    expect(screen.queryByText("Splash")).toBeNull();
    expect(screen.getByTestId("mock-home")).toBeTruthy();
  });

  it("opens on Home and reaches every everyday destination from the menu", async () => {
    render(<App />);
    expect(screen.getByTestId("mock-home")).toBeTruthy();
    expect(document.querySelector('[data-view="home"]')).toBeTruthy();

    // Every destination but Home and Today loads on first use.
    go("Talk");
    expect(await screen.findByText("chat-list-screen", undefined, LAZY_ROUTE)).toBeTruthy();
    go("Calendar");
    expect(await screen.findByText("schedule-screen", undefined, LAZY_ROUTE)).toBeTruthy();
    go("Notes");
    expect(await screen.findByText("notes-initial-none", undefined, LAZY_ROUTE)).toBeTruthy();
    go("Ideas");
    expect(await screen.findByText("ideas-screen", undefined, LAZY_ROUTE)).toBeTruthy();
    go("New chat");
    expect((await screen.findByTestId("mock-chat")).textContent).toContain("session-new");
    go("Today");
    expect(document.querySelector('[data-view="today"]')).toBeTruthy();
    go("Home");
    expect(document.querySelector('[data-view="home"]')).toBeTruthy();
  });

  // Temporary until phase C redesigns Home: both render the Today screen but are
  // distinct destinations, so replacing Home later changes no navigation.
  it("keeps Home and Today as distinct destinations while both show Today", () => {
    render(<App />);
    expect(document.querySelector('[data-view="home"]')).toBeTruthy();
    expect(within(openMenu()).getByRole("button", { name: "Home" }).getAttribute("aria-current")).toBe("page");
    go("Today");
    expect(document.querySelector('[data-view="today"]')).toBeTruthy();
    expect(document.querySelector('[data-view="home"]')).toBeNull();
    expect(within(openMenu()).getByRole("button", { name: "Today" }).getAttribute("aria-current")).toBe("page");
    expect(within(openMenu()).getByRole("button", { name: "Home" }).hasAttribute("aria-current")).toBe(false);
  });

  it("keeps every previous destination in the menu's AVA section, plus Activity", async () => {
    render(<App />);
    const menu = openMenu();
    const section = within(menu).getByRole("heading", { name: "AVA" }).parentElement!;
    const labels = Array.from(section.querySelectorAll("button")).map((button) => button.textContent);
    expect(labels).toEqual([
      "Memory", "Reminders & watches", "Explore AVA", "Visual explanations", "Activity", "Self development", "Settings",
    ]);

    const destinations: Array<[string, string]> = [
      ["Explore AVA", "capabilities"],
      ["Reminders & watches", "watches"],
      ["Memory", "memory"],
      ["Visual explanations", "visuals"],
      ["Settings", "rules"],
      ["Self development", "self"],
      ["Activity", "activity"],
    ];
    for (const [label, view] of destinations) {
      go(label);
      // Explore, Memory, Visuals and Activity are lazy routes.
      await waitFor(() => expect(document.querySelector(`[data-view="${view}"]`), label).toBeTruthy(), LAZY_ROUTE);
    }
  });

  it("opens Activity inside AVA instead of a separate window", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<App />);
    go("Activity");
    expect(await screen.findByText("mission-control-screen", undefined, LAZY_ROUTE)).toBeTruthy();
    expect(open).not.toHaveBeenCalled();
    expect(document.querySelector('[data-view="activity"]')).toBeTruthy();
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
    go("New chat");
    await screen.findByTestId("mock-chat");
    fireEvent.click(screen.getByRole("button", { name: "mock change draft" }));
    expect(screen.getByTestId("mock-chat").textContent).toContain("draft-1");

    go("New chat");
    await waitFor(() => expect(screen.getByTestId("mock-chat").textContent).toContain("draft-0"));
  });

  it("carries a Home suggestion into a new chat", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "mock home command" }));
    expect((await screen.findByTestId("mock-chat")).textContent).toContain("initial-open exact project");
  });

  it("opens the exact note chosen on Home or in Ideas", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "mock home note" }));
    expect(await screen.findByText("notes-initial-note-7", undefined, LAZY_ROUTE)).toBeTruthy();
    go("Ideas");
    fireEvent.click(await screen.findByRole("button", { name: "mock open idea" }, LAZY_ROUTE));
    expect(await screen.findByText("notes-initial-idea-3", undefined, LAZY_ROUTE)).toBeTruthy();
  });

  it("unmounts Home before another workspace is presented", async () => {
    render(<App />);
    expect(screen.getByRole("button", { name: "mock home command" })).toBeTruthy();
    go("Explore AVA");
    expect(await screen.findByText("explorer-workspace")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "mock home command" })).toBeNull();
    expect(document.querySelectorAll("[data-view]")).toHaveLength(1);
    expect(document.querySelector('[data-view="capabilities"]')).toBeTruthy();
  });

  it("has retired the legacy Strategy Room: no destination and no chat handoff", async () => {
    render(<App />);
    expect(within(openMenu()).queryByRole("button", { name: "Strategy Room" })).toBeNull();
    go("New chat");
    await screen.findByTestId("mock-chat");
    fireEvent.click(screen.getByRole("button", { name: "mock take to room" }));
    expect(screen.queryByText(/room-source-/)).toBeNull();
    expect(screen.getByTestId("mock-chat")).toBeTruthy();
  });

  it("opens the exact AVA visual emitted by the chat tool path", async () => {
    render(<App />);
    go("New chat");
    await screen.findByTestId("mock-chat");
    fireEvent.click(screen.getByRole("button", { name: "mock open visual" }));
    expect(await screen.findByText("visual-id-visual_abcdefgh")).toBeTruthy();
  });

  it("opens each kind of item from a reply's Saved card in its own place", async () => {
    render(<App />);
    const openChat = async () => {
      go("New chat");
      await screen.findByTestId("mock-chat", undefined, LAZY_ROUTE);
    };
    await openChat();
    fireEvent.click(screen.getByRole("button", { name: "mock open saved idea" }));
    expect(await screen.findByText("notes-initial-idea-saved-1", undefined, LAZY_ROUTE)).toBeTruthy();

    await openChat();
    fireEvent.click(screen.getByRole("button", { name: "mock open saved reminder" }));
    expect(await screen.findByText("schedule-screen", undefined, LAZY_ROUTE)).toBeTruthy();

    await openChat();
    fireEvent.click(screen.getByRole("button", { name: "mock open saved watch" }));
    expect(await screen.findByText("focus-w-watch-2", undefined, LAZY_ROUTE)).toBeTruthy();

    await openChat();
    fireEvent.click(screen.getByRole("button", { name: "mock open saved memory" }));
    await waitFor(() => expect(document.querySelector('[data-view="memory"]')).toBeTruthy());
  });

  it("hands voice the session ChatScreen actually created, not the stale null route value", async () => {
    render(<App />);
    go("New chat");
    await screen.findByTestId("mock-chat");
    fireEvent.click(screen.getByRole("button", { name: "mock enter voice" }));
    expect(await screen.findByText(/voice-session-internal-chat-17-intent-resume/, undefined, LAZY_ROUTE)).toBeTruthy();
  });

  it("marks voice entry from a blank New chat as a fresh conversation", async () => {
    render(<App />);
    go("New chat");
    await screen.findByTestId("mock-chat");
    fireEvent.click(screen.getByRole("button", { name: "mock enter blank voice" }));
    expect(await screen.findByText(/voice-session-none-intent-new/, undefined, LAZY_ROUTE)).toBeTruthy();
  });

  it("lets Today voice continue Nika's latest conversation when none is remembered", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Talk to AVA" }));
    expect(await screen.findByText(/voice-session-none-intent-continue/, undefined, LAZY_ROUTE)).toBeTruthy();
  });

  it("sends Today voice back to the exact remembered conversation", async () => {
    window.localStorage.setItem("ava:last-chat-session", "remembered-8");
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Talk to AVA" }));
    expect(await screen.findByText(/voice-session-remembered-8-intent-resume/, undefined, LAZY_ROUTE)).toBeTruthy();
  });

  it("moves the current chat to the conversation voice actually bound", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Talk to AVA" }));
    fireEvent.click(await screen.findByRole("button", { name: "mock voice bound" }, LAZY_ROUTE));
    expect(window.localStorage.getItem("ava:last-chat-session")).toBe("voice-bound-5");
    fireEvent.click(screen.getByRole("button", { name: "mock voice exit" }));
    expect(screen.getByTestId("mock-home")).toBeTruthy();
    go("Talk");
    expect((await screen.findByTestId("mock-chat")).textContent).toContain("session-voice-bound-5");
  });

  it("forgets the remembered chat only when voice finds that exact one unavailable", async () => {
    window.localStorage.setItem("ava:last-chat-session", "gone-2");
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Talk to AVA" }));
    fireEvent.click(await screen.findByRole("button", { name: "mock voice unavailable" }, LAZY_ROUTE));
    expect(window.localStorage.getItem("ava:last-chat-session")).toBeNull();
  });

  it("forgets the conversation Today voice bound when that one becomes unavailable", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Talk to AVA" }));
    fireEvent.click(await screen.findByRole("button", { name: "mock voice bound" }, LAZY_ROUTE));
    expect(window.localStorage.getItem("ava:last-chat-session")).toBe("voice-bound-5");
    fireEvent.click(screen.getByRole("button", { name: "mock voice unavailable" }));
    expect(window.localStorage.getItem("ava:last-chat-session")).toBeNull();
  });

  it("forgets the new conversation voice moved to, not the one it was entered with", async () => {
    window.localStorage.setItem("ava:last-chat-session", "remembered-8");
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Talk to AVA" }));
    fireEvent.click(await screen.findByRole("button", { name: "mock voice bound" }, LAZY_ROUTE));
    fireEvent.click(screen.getByRole("button", { name: "mock voice unavailable" }));
    expect(window.localStorage.getItem("ava:last-chat-session")).toBeNull();
  });

  it("never lets an earlier voice visit's binding decide what a later visit forgets", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Talk to AVA" }));
    fireEvent.click(await screen.findByRole("button", { name: "mock voice bound" }, LAZY_ROUTE));
    fireEvent.click(screen.getByRole("button", { name: "mock voice exit" }));
    // A different conversation becomes current, then a new voice visit finds it
    // unavailable before binding anything.
    go("New chat");
    fireEvent.click(await screen.findByRole("button", { name: "mock establish session" }));
    expect(window.localStorage.getItem("ava:last-chat-session")).toBe("internal-chat-17");
    go("Today");
    fireEvent.click(screen.getByRole("button", { name: "Talk to AVA" }));
    expect(await screen.findByText(/voice-session-internal-chat-17-intent-resume/, undefined, LAZY_ROUTE)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "mock voice unavailable" }));
    expect(window.localStorage.getItem("ava:last-chat-session")).toBeNull();
  });

  it("does not play the intro after a reduced-motion first load switches to full motion", () => {
    window.sessionStorage.clear();
    window.localStorage.setItem("ava-motion", "reduced");
    const first = render(<App />);
    expect(screen.getByTestId("mock-home")).toBeTruthy();
    first.unmount();
    window.localStorage.removeItem("ava-motion");
    render(<App />);
    expect(screen.queryByText("Splash")).toBeNull();
    expect(screen.getByTestId("mock-home")).toBeTruthy();
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
    expect(screen.getByTestId("mock-home")).toBeTruthy();
  });

  it("opens a watch run for reference without making it the current chat", async () => {
    window.localStorage.setItem("ava:last-chat-session", "mine-1");
    render(<App />);
    go("Reminders & watches");
    fireEvent.click(screen.getByRole("button", { name: "mock open watch run" }));
    expect((await screen.findByTestId("mock-chat")).textContent).toContain("session-watch-run-9-draft-0-audit-true");
    expect(window.localStorage.getItem("ava:last-chat-session")).toBe("mine-1");
  });

  it("loads the Mission Control window on demand at its own address", async () => {
    window.history.replaceState(null, "", "/?mission-control=1");
    render(<App />);
    expect(await screen.findByText("mission-control-screen", undefined, LAZY_ROUTE)).toBeTruthy();
    expect(screen.queryByTestId("mock-home")).toBeNull();
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
    go("New chat");
    await screen.findByTestId("mock-chat");
    fireEvent.click(screen.getByRole("button", { name: "mock establish session" }));
    go("Explore AVA");
    go("Talk");
    expect((await screen.findByTestId("mock-chat")).textContent).toContain("session-internal-chat-17");
  });

  it("Talk restores the remembered chat after an application reload", async () => {
    window.localStorage.setItem("ava:last-chat-session", "persisted-chat-42");
    const first = render(<App />);
    first.unmount();
    render(<App />);
    go("Talk");
    expect((await screen.findByTestId("mock-chat")).textContent).toContain("session-persisted-chat-42");
  });

  it("Schedule's only action goes to Talk", async () => {
    window.localStorage.setItem("ava:last-chat-session", "persisted-chat-42");
    render(<App />);
    go("Calendar");
    fireEvent.click(await screen.findByRole("button", { name: "mock schedule talk" }, LAZY_ROUTE));
    expect((await screen.findByTestId("mock-chat")).textContent).toContain("session-persisted-chat-42");
  });

  describe("bottom bar", () => {
    beforeEach(() => { state.chatMounts.length = 0; });

    it("sends the bar's text as exactly one new conversation, even on a double press", async () => {
      render(<App />);
      const input = screen.getByLabelText("Message AVA") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "Plan my day" } });
      const form = input.closest("form")!;
      fireEvent.submit(form);
      fireEvent.submit(form);
      expect((await screen.findByTestId("mock-chat", undefined, LAZY_ROUTE)).textContent).toContain("initial-Plan my day");
      expect(state.chatMounts).toEqual(["Plan my day"]);
      expect((screen.getByLabelText("Message AVA") as HTMLInputElement).value).toBe("");
    });

    it("is mounted once: navigation and the menu never remount it or lose the draft", async () => {
      render(<App />);
      const bar = screen.getByRole("navigation", { name: "AVA" });
      fireEvent.change(screen.getByLabelText("Message AVA"), { target: { value: "half-written thought" } });
      go("Notes");
      expect(await screen.findByText("notes-initial-none", undefined, LAZY_ROUTE)).toBeTruthy();
      go("Today");
      expect(screen.getByRole("navigation", { name: "AVA" })).toBe(bar);
      expect((screen.getByLabelText("Message AVA") as HTMLInputElement).value).toBe("half-written thought");
    });

    it("is Talk's message box: sends go into that conversation, never a new one", async () => {
      render(<App />);
      const bar = screen.getByRole("navigation", { name: "AVA" });
      go("New chat");
      await screen.findByTestId("mock-chat", undefined, LAZY_ROUTE);
      const mountsBefore = state.chatMounts.length;
      expect(bar.hasAttribute("data-compact")).toBe(false);
      const box = within(bar).getByRole("textbox", { name: "Message AVA" });
      expect(box.getAttribute("placeholder")).toBe("Message AVA…");

      fireEvent.change(box, { target: { value: "into this chat" } });
      fireEvent.keyDown(box, { key: "Enter" });
      expect(state.talkSends).toEqual(["into this chat"]);
      expect((box as HTMLTextAreaElement).value).toBe("");
      expect(state.chatMounts.length).toBe(mountsBefore);
      // There is only ever one message box on screen.
      expect(screen.getAllByRole("textbox", { name: /message/i })).toHaveLength(1);
    });

    it("turns Send into Stop while AVA replies, and keeps voice one tap away", async () => {
      render(<App />);
      go("New chat");
      await screen.findByTestId("mock-chat", undefined, LAZY_ROUTE);
      fireEvent.click(screen.getByRole("button", { name: "mock toggle busy" }));
      const bar = screen.getByRole("navigation", { name: "AVA" });
      fireEvent.change(within(bar).getByRole("textbox", { name: "Message AVA" }), { target: { value: "wait for it" } });
      fireEvent.keyDown(within(bar).getByRole("textbox", { name: "Message AVA" }), { key: "Enter" });
      expect(state.talkSends).toEqual([]);
      fireEvent.click(within(bar).getByRole("button", { name: "Stop AVA" }));
      expect(state.talkStops).toBe(1);
      fireEvent.click(within(bar).getByRole("button", { name: "Talk to AVA" }));
      await screen.findByText(/voice-session-internal-chat-17/, undefined, LAZY_ROUTE);
    });

    it("gives words back into the bar and keeps a draft across Talk, Voice and Home", async () => {
      render(<App />);
      const bar = screen.getByRole("navigation", { name: "AVA" });
      go("New chat");
      await screen.findByTestId("mock-chat", undefined, LAZY_ROUTE);
      fireEvent.click(screen.getByRole("button", { name: "mock give words back" }));
      const box = within(bar).getByRole("textbox", { name: "Message AVA" }) as HTMLTextAreaElement;
      expect(box.value).toBe("words given back");
      expect(document.activeElement).toBe(box);

      fireEvent.click(screen.getByRole("button", { name: "mock enter voice" }));
      await screen.findByText(/voice-session-/, undefined, LAZY_ROUTE);
      expect(screen.getByRole("navigation", { name: "AVA" })).toBe(bar);
      expect(bar.hasAttribute("data-compact")).toBe(true);
      expect(within(bar).queryByRole("textbox")).toBeNull();
      // Voice keeps the way back: the menu still opens from the compact button.
      go("Home");
      expect(document.querySelector('[data-view="home"]')).toBeTruthy();
      expect(bar.hasAttribute("data-compact")).toBe(false);
      expect((screen.getByLabelText("Message AVA") as HTMLTextAreaElement).value).toBe("words given back");
      // Off Talk, the bar starts a new conversation again.
      fireEvent.keyDown(screen.getByLabelText("Message AVA"), { key: "Enter" });
      await screen.findByText("initial-words given back", undefined, LAZY_ROUTE);
      expect(state.talkSends).toEqual([]);
    });

    it("returns focus to the menu button when the menu closes with Escape", () => {
      render(<App />);
      const menu = openMenu();
      fireEvent.keyDown(within(menu).getByRole("button", { name: "Home" }), { key: "Escape" });
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open menu" }));
    });

    it("goes Home when leaving Voice that was entered from the landing page", async () => {
      render(<App />);
      fireEvent.click(screen.getByRole("button", { name: "Talk to AVA" }));
      fireEvent.click(await screen.findByRole("button", { name: "mock voice exit" }, LAZY_ROUTE));
      expect(document.querySelector('[data-view="home"]')).toBeTruthy();
    });

    it("lists recent human conversations and opens one", async () => {
      const api = await import("./api.js");
      vi.spyOn(api, "fetchSessionPage").mockResolvedValue({
        sessions: [{ id: "recent-1", title: "Agile reflection plan", lastHumanMessageAt: Date.now(), updatedAt: Date.now(), createdAt: Date.now() } as never],
        nextCursor: null,
      } as never);
      render(<App />);
      const menu = openMenu();
      fireEvent.click(await within(menu).findByRole("button", { name: /Agile reflection plan/ }));
      expect((await screen.findByTestId("mock-chat", undefined, LAZY_ROUTE)).textContent).toContain("session-recent-1");
    });
  });
});
