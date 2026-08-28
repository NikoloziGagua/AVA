import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Home, Plus, List, Brain, Settings2, Sparkles, Radar, MessagesSquare, NotebookPen, Presentation } from "lucide-react";
import { Flip } from "./lib/gsap.js";
import { TubelightNav, type TubelightItem } from "./components/ava/TubelightNav.js";
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
import { Splash } from "./splash/Splash.js";
import { GlassFilter } from "./components/ava/GlassFilter.js";

type View =
  | { name: "splash" }
  | { name: "orbit" }
  | { name: "chat"; sessionId: string | null; initialText?: string }
  | { name: "voice"; from: "orbit" | "chat"; sessionId: string | null }
  | { name: "memory" }
  | { name: "notes" }
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

/** Which nav lamp to light for a view. Voice/splash return undefined (no nav). */
function navForView(v: View): string | undefined {
  switch (v.name) {
    case "orbit": return "Home";
    // Opening an EXISTING chat is "viewing history" → Chats; only a brand-new
    // (sessionId === null) composition lights "New".
    case "chat": return v.sessionId === null ? "New" : "Chats";
    case "memory": return "Memory";
    case "notes": return "Notes";
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
  const reduced = useReducedMotion();

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

  // Persistent deck nav — the bar stays put while panels swap, tracks the current
  // view, and lets you jump straight between Home / Chats / Memory / Rules / Self.
  const navItems: TubelightItem[] = [
    { name: "Home", icon: Home, onSelect: () => setView({ name: "orbit" }) },
    { name: "New", icon: Plus, onSelect: () => openNewChat() },
    { name: "Chats", icon: List, onSelect: () => setView({ name: "list" }) },
    { name: "Memory", icon: Brain, onSelect: () => setView({ name: "memory" }) },
    { name: "Notes", icon: NotebookPen, onSelect: () => setView({ name: "notes" }) },
    { name: "Explore", icon: Radar, onSelect: () => setView({ name: "capabilities" }) },
    { name: "Visuals", icon: Presentation, onSelect: () => setView({ name: "visuals" }) },
    { name: "Room", icon: MessagesSquare, onSelect: () => setView({ name: "strategy" }) },
    { name: "Rules", icon: Settings2, onSelect: () => setView({ name: "rules" }) },
    { name: "Self", icon: Sparkles, onSelect: () => setView({ name: "self" }) },
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
              onExit={(sid) => {
                if (view.from === "chat") setView({ name: "chat", sessionId: sid });
                else setView({ name: "orbit" });
              }}
              onSwitchToKeyboard={(sid) => setView({ name: "chat", sessionId: sid })}
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
              onOpenChat={(sessionId) => setView({ name: "chat", sessionId })}
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
              onOpenChat={(sessionId) => setView({ name: "chat", sessionId })}
            />
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
              onOpenChat={(sid) => setView({ name: "chat", sessionId: sid })}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Persistent deck nav: stays mounted (so the cyan lamp springs smoothly
          between panels) and fades out on the immersive hero views (splash/voice).
          Chat joins the deck — the lamp lights "New" for a fresh chat, "Chats"
          for an existing one. */}
      <motion.div
        className="absolute left-1/2 z-30 -translate-x-1/2"
        animate={{ opacity: showNav ? 1 : 0, y: showNav ? 0 : -14 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        style={{
          pointerEvents: showNav ? "auto" : "none",
          // top-6 plus the notch/status-bar inset on phones (env() is 0 on desktop).
          top: "calc(env(safe-area-inset-top, 0px) + 1.5rem)",
        }}
      >
        <TubelightNav items={navItems} activeName={activeNav} />
      </motion.div>
    </div>
  );
}
