import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Home, Brain, Settings2, Sparkles, Radar, MessagesSquare, NotebookPen, Presentation, AlarmClock } from "lucide-react";
import { Flip } from "./lib/gsap.js";
import { AppSidebar, type AppSidebarItem } from "./components/ava/AppSidebar.js";
import { SCREEN, markTransition } from "./lib/deckMotion.js";
import { useReducedMotion } from "./lib/useReducedMotion.js";
import { getToken } from "./auth/tokens.js";
import { PairingScreen } from "./auth/PairingScreen.js";
import { ChatScreen } from "./chat/ChatScreen.js";
import { RulesScreen } from "./rules/RulesScreen.js";
import { MemoryScreen } from "./memory/MemoryScreen.js";
import { NotesScreen } from "./notes/NotesScreen.js";
import { SelfScreen } from "./self/SelfScreen.js";
import { OrbitScreen } from "./orbit/OrbitScreen.js";
import { ChatListScreen } from "./orbit/ChatListScreen.js";
import { VoiceScreen } from "./voice/VoiceScreen.js";
import { ExplorerScreen } from "./explorer/ExplorerScreen.js";
import { MissionControlScreen } from "./mission-control/MissionControlScreen.js";
import { StrategyRoomScreen } from "./strategy/StrategyRoomScreen.js";
import { VisualsScreen } from "./visuals/VisualsScreen.js";
import { WatchesScreen } from "./watches/WatchesScreen.js";
import { Splash } from "./splash/Splash.js";
import { GlassFilter } from "./components/ava/GlassFilter.js";

type View =
  | { name: "splash" }
  | { name: "orbit" }
  | { name: "chat"; sessionId: string | null; initialText?: string }
  | { name: "voice"; from: "orbit" | "chat"; sessionId: string | null }
  | { name: "memory" }
  | { name: "notes" }
  | { name: "watches" }
  | { name: "rules" }
  | { name: "self" }
  | { name: "strategy"; sourceSessionId?: string }
  | { name: "visuals"; visualId?: string }
  | { name: "capabilities" }
  | { name: "list" };

// Only these surfaces own the mercury Orb (with flipId="ava-orb"): splash → home
// hero → voice hero. ChatScreen renders NO orb, so it must not be listed here —
// otherwise entering chat would capture the still-exiting orbit orb and the next
// orb view would Flip from a stale snapshot.
const VIEWS_WITH_ORB = ["splash", "orbit", "voice"];
const LAST_CHAT_STORAGE_KEY = "ava:last-chat-session";
const SIDEBAR_STORAGE_KEY = "ava:sidebar-expanded";

function readStoredChat(): string | null {
  try { return window.localStorage.getItem(LAST_CHAT_STORAGE_KEY); }
  catch { return null; }
}

function readSidebarPreference(): boolean {
  try {
    const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (stored !== null) return stored === "true";
  } catch { /* storage can be unavailable in hardened browsers */ }
  return window.innerWidth >= 1024;
}

/** Which sidebar destination to mark for a view. Voice/splash return undefined. */
function navForView(v: View): string | undefined {
  switch (v.name) {
    case "orbit": return "Home";
    // Opening an EXISTING chat is "viewing history" → Chats; only a brand-new
    // (sessionId === null) composition lights "New".
    case "chat": return v.sessionId === null ? "New" : "Chats";
    case "memory": return "Memory";
    case "notes": return "Notes";
    case "watches": return "Watches";
    case "rules": return "Rules";
    case "self": return "Self";
    case "strategy": return "Room";
    case "visuals": return "Visuals";
    case "capabilities": return "Explore";
    case "list": return "Chats";
    default: return undefined;
  }
}

export function App() {
  const [paired, setPaired] = useState<boolean>(!!getToken());
  const [view, setView] = useState<View>({ name: "splash" });
  // A fresh-chat view can remain `sessionId:null` after ChatScreen internally
  // receives a server session. Incrementing this key makes a second press of
  // New genuinely discard that draft and mount a clean conversation.
  const [newChatRevision, setNewChatRevision] = useState(0);
  const [lastChatSessionId, setLastChatSessionId] = useState<string | null>(readStoredChat);
  const [sidebarExpanded, setSidebarExpanded] = useState(readSidebarPreference);
  const reduced = useReducedMotion();

  const rememberChat = useCallback((sessionId: string) => {
    setLastChatSessionId(sessionId);
    try { window.localStorage.setItem(LAST_CHAT_STORAGE_KEY, sessionId); } catch { /* non-critical */ }
  }, []);

  const openChat = useCallback((sessionId: string | null) => {
    if (sessionId) rememberChat(sessionId);
    setView({ name: "chat", sessionId });
  }, [rememberChat]);

  const setSidebarOpen = useCallback((expanded: boolean) => {
    setSidebarExpanded(expanded);
    try { window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(expanded)); } catch { /* non-critical */ }
  }, []);

  const forgetUnavailableChat = useCallback(() => {
    setLastChatSessionId(null);
    try { window.localStorage.removeItem(LAST_CHAT_STORAGE_KEY); } catch { /* non-critical */ }
  }, []);

  const openNewChat = (initialText?: string) => {
    setNewChatRevision((revision) => revision + 1);
    setView({ name: "chat", sessionId: null, ...(initialText ? { initialText } : {}) });
  };

  // Expired/invalid token → back to pairing. api.ts dispatches `ava:unauthorized`
  // (+ clearToken) on a 401; we just listen and drop back to the pairing screen.
  useEffect(() => {
    const h = () => setPaired(false);
    window.addEventListener("ava:unauthorized", h);
    return () => window.removeEventListener("ava:unauthorized", h);
  }, []);

  // ── Transition window: mark it so the always-on WebGL loops idle during the
  // overlap, and flag the deck panels so their glass tree drops backdrop-filter
  // (no per-frame re-blur while a subtree opacity-fades).
  const [transitioning, setTransitioning] = useState(false);
  useEffect(() => {
    const ms = SCREEN.enter * 1000 + 40;
    markTransition(ms);
    setTransitioning(true);
    const t = window.setTimeout(() => setTransitioning(false), ms);
    return () => window.clearTimeout(t);
  }, [view]);

  // GSAP Flip: the shared orb glides between the surfaces that own it (splash →
  // home → voice) instead of cutting. The query is SCOPED to the entering view's
  // subtree (via data-view) so the concurrently-mounted exiting orb can't be
  // captured, and Flip.from targets that same entering orb explicitly. Panels
  // (and chat) own no orb → the state is nulled so a stale orb can't drive them.
  const flipStateRef = useRef<ReturnType<typeof Flip.getState> | null>(null);
  useLayoutEffect(() => {
    if (reduced || !VIEWS_WITH_ORB.includes(view.name)) {
      flipStateRef.current = null;
      return;
    }
    const orb = document.querySelector(`[data-view='${view.name}'] [data-flip-id='ava-orb']`);
    if (!orb) {
      flipStateRef.current = null;
      return;
    }
    if (flipStateRef.current) {
      try {
        // `targets: orb` pins the animation to the ENTERING orb (ignores the
        // exiting one); no `scale:true` — the shorthand can't be reset by GSAP
        // and logged "scale not eligible for reset" on every orb view.
        Flip.from(flipStateRef.current, {
          targets: orb,
          duration: SCREEN.orb,
          ease: "power2.inOut",
          absolute: true,
        });
      } catch { /* degrade to no animation */ }
    }
    try { flipStateRef.current = Flip.getState(orb); } catch { flipStateRef.current = null; }
  }, [view.name, reduced]);

  // Persistent product destinations live in the sidebar. Recent conversations
  // are fetched by that component, while this array remains routing-only.
  const navItems: AppSidebarItem[] = [
    { name: "Home", label: "Home", icon: Home, group: "main", onSelect: () => setView({ name: "orbit" }) },
    { name: "Explore", label: "Explore AVA", icon: Radar, group: "main", onSelect: () => setView({ name: "capabilities" }) },
    { name: "Notes", label: "Notes", icon: NotebookPen, group: "work", onSelect: () => setView({ name: "notes" }) },
    { name: "Watches", label: "Watches", icon: AlarmClock, group: "work", onSelect: () => setView({ name: "watches" }) },
    { name: "Memory", label: "Memory", icon: Brain, group: "work", onSelect: () => setView({ name: "memory" }) },
    { name: "Room", label: "Strategy Room", icon: MessagesSquare, group: "work", onSelect: () => setView({ name: "strategy" }) },
    { name: "Visuals", label: "Visual explanations", icon: Presentation, group: "work", onSelect: () => setView({ name: "visuals" }) },
    { name: "Rules", label: "Settings & rules", icon: Settings2, group: "system", onSelect: () => setView({ name: "rules" }) },
    { name: "Self", label: "Self development", icon: Sparkles, group: "system", onSelect: () => setView({ name: "self" }) },
  ];
  const activeNav = navForView(view);
  const showNav = activeNav !== undefined;

  // Shared enter/exit timings — every screen uses the same tokens. Out is faster
  // than in so the outgoing layer clears before the incoming settles.
  const enterT = { duration: reduced ? 0.14 : SCREEN.enter, ease: SCREEN.easeEnter };
  const exitT = { duration: reduced ? 0.1 : SCREEN.exit, ease: SCREEN.easeExit };
  const exitTo = { ...SCREEN.exitTo, transition: exitT };
  const deckTransition = transitioning || undefined;

  if (!paired) return <PairingScreen onPaired={() => setPaired(true)} />;
  if (new URLSearchParams(window.location.search).get("mission-control") === "1") {
    return <MissionControlScreen />;
  }

  return (
    <div className="relative w-full h-full overflow-hidden bg-black text-white">
      <GlassFilter />
      <AppSidebar
        items={navItems}
        activeName={activeNav}
        visible={showNav}
        expanded={sidebarExpanded}
        activeChatSessionId={lastChatSessionId}
        onExpandedChange={setSidebarOpen}
        onNewChat={() => openNewChat()}
        onOpenCurrentChat={() => lastChatSessionId ? openChat(lastChatSessionId) : setView({ name: "list" })}
        onOpenChat={(sessionId) => openChat(sessionId)}
        onOpenAllChats={() => setView({ name: "list" })}
        onCurrentChatUnavailable={forgetUnavailableChat}
      />
      <div
        className="ava-app-stage"
        data-sidebar-visible={showNav || undefined}
        data-sidebar-expanded={(showNav && sidebarExpanded) || undefined}
      >
      {/* No mode="wait": the home/voice screens have infinite CSS animations
          (nebula drift, orb morph) that never "finish", so mode="wait" would
          wait forever for exit-complete and never mount the next view. Default
          concurrent mode cross-dissolves — and every screen now enters/exits with
          the SAME tokens so the swap reads as one coherent motion, not a pile of
          mismatched pops and fades. */}
      <AnimatePresence>
        {view.name === "splash" && (
          <motion.div
            key="splash"
            data-view="splash"
            className="absolute inset-0"
            exit={exitTo}
          >
            <Splash onDone={() => setView({ name: "orbit" })} />
          </motion.div>
        )}
        {view.name === "orbit" && (
          <motion.div
            key="orbit"
            data-view="orbit"
            className="absolute inset-0"
            initial={SCREEN.from}
            animate={SCREEN.to}
            exit={exitTo}
            transition={enterT}
          >
            <OrbitScreen
              onCommand={(text) => openNewChat(text)}
              onEnterVoice={() => setView({ name: "voice", from: "orbit", sessionId: null })}
              onExplore={() => setView({ name: "capabilities" })}
            />
          </motion.div>
        )}
        {view.name === "chat" && (
          <motion.div
            key={view.sessionId ? `chat-${view.sessionId}` : `chat-new-${newChatRevision}`}
            data-view="chat"
            className="absolute inset-0"
            initial={SCREEN.from}
            animate={SCREEN.to}
            exit={exitTo}
            transition={enterT}
          >
            <ChatScreen
              sessionId={view.sessionId}
              initialText={view.initialText}
              onSessionChange={rememberChat}
              onOpenSessions={() => setView({ name: "orbit" })}
              onOpenRules={() => setView({ name: "rules" })}
              onOpenMemory={() => setView({ name: "memory" })}
              onOpenList={() => setView({ name: "list" })}
              onEnterVoice={(sessionId) => setView({ name: "voice", from: "chat", sessionId })}
              onOpenStrategy={(sessionId) => setView({ name: "strategy", sourceSessionId: sessionId })}
              onOpenVisual={(visualId) => setView({ name: "visuals", visualId })}
            />
          </motion.div>
        )}
        {view.name === "voice" && (
          <motion.div
            key="voice"
            data-view="voice"
            className="absolute inset-0"
            initial={SCREEN.from}
            animate={SCREEN.to}
            exit={exitTo}
            transition={enterT}
          >
            <VoiceScreen
              initialSessionId={view.sessionId}
              // A null id has two different meanings. From Home it means
              // "resume my latest conversation"; from a blank New chat it means
              // "this is deliberately a new conversation". Preserve that
              // distinction so voice cannot jump from a fresh chat into the
              // most recently used voice thread.
              startFresh={view.from === "chat" && view.sessionId === null}
              onExit={(sid) => {
                if (view.from === "chat") openChat(sid);
                else setView({ name: "orbit" });
              }}
              onSwitchToKeyboard={(sid) => openChat(sid)}
            />
          </motion.div>
        )}
        {view.name === "memory" && (
          <motion.div
            key="memory"
            data-view="memory"
            data-deck-transition={deckTransition}
            className="absolute inset-0"
            initial={SCREEN.from}
            animate={SCREEN.to}
            exit={exitTo}
            transition={enterT}
          >
            <MemoryScreen
              onClose={() => setView({ name: "orbit" })}
              onOpenChat={(sessionId) => openChat(sessionId)}
            />
          </motion.div>
        )}
        {view.name === "rules" && (
          <motion.div
            key="rules"
            data-view="rules"
            data-deck-transition={deckTransition}
            className="absolute inset-0"
            initial={SCREEN.from}
            animate={SCREEN.to}
            exit={exitTo}
            transition={enterT}
          >
            <RulesScreen onClose={() => setView({ name: "orbit" })} />
          </motion.div>
        )}
        {view.name === "self" && (
          <motion.div
            key="self"
            data-view="self"
            data-deck-transition={deckTransition}
            className="absolute inset-0"
            initial={SCREEN.from}
            animate={SCREEN.to}
            exit={exitTo}
            transition={enterT}
          >
            <SelfScreen onClose={() => setView({ name: "orbit" })} />
          </motion.div>
        )}
        {view.name === "notes" && (
          <motion.div
            key="notes"
            data-view="notes"
            data-deck-transition={deckTransition}
            className="absolute inset-0"
            initial={SCREEN.from}
            animate={SCREEN.to}
            exit={exitTo}
            transition={enterT}
          >
            <NotesScreen onStartTask={(text) => openNewChat(text)} />
          </motion.div>
        )}
        {view.name === "strategy" && (
          <motion.div
            key={view.sourceSessionId ? `strategy-${view.sourceSessionId}` : "strategy"}
            data-view="strategy"
            data-deck-transition={deckTransition}
            className="absolute inset-0"
            initial={SCREEN.from}
            animate={SCREEN.to}
            exit={exitTo}
            transition={enterT}
          >
            <StrategyRoomScreen
              sourceSessionId={view.sourceSessionId ?? null}
              onOpenChat={(sessionId) => openChat(sessionId)}
            />
          </motion.div>
        )}
        {view.name === "watches" && (
          <motion.div
            key="watches"
            data-view="watches"
            data-deck-transition={deckTransition}
            className="absolute inset-0"
            initial={SCREEN.from}
            animate={SCREEN.to}
            exit={exitTo}
            transition={enterT}
          >
            <WatchesScreen onOpenChat={(sessionId) => setView({ name: "chat", sessionId })} />
          </motion.div>
        )}
        {view.name === "visuals" && (
          <motion.div
            key={view.visualId ? `visuals-${view.visualId}` : "visuals"}
            data-view="visuals"
            data-deck-transition={deckTransition}
            className="absolute inset-0"
            initial={SCREEN.from}
            animate={SCREEN.to}
            exit={exitTo}
            transition={enterT}
          >
            <VisualsScreen
              initialVisualId={view.visualId ?? null}
              onCreate={(text) => openNewChat(text)}
            />
          </motion.div>
        )}
        {view.name === "capabilities" && (
          <motion.div
            key="capabilities"
            data-view="capabilities"
            data-deck-transition={deckTransition}
            className="absolute inset-0"
            initial={SCREEN.from}
            animate={SCREEN.to}
            exit={exitTo}
            transition={enterT}
          >
            <ExplorerScreen
              onLaunch={(text) => openNewChat(text)}
            />
          </motion.div>
        )}
        {view.name === "list" && (
          <motion.div
            key="list"
            data-view="list"
            data-deck-transition={deckTransition}
            className="absolute inset-0"
            initial={SCREEN.from}
            animate={SCREEN.to}
            exit={exitTo}
            transition={enterT}
          >
            <ChatListScreen
              onClose={() => setView({ name: "orbit" })}
              onOpenChat={(sid) => openChat(sid)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      </div>
    </div>
  );
}
