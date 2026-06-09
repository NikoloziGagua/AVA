import { useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Home, Plus, List, Brain, Settings2, Sparkles } from "lucide-react";
import { Flip } from "./lib/gsap.js";
import { TubelightNav, type TubelightItem } from "./components/ava/TubelightNav.js";
import { useReducedMotion } from "./lib/useReducedMotion.js";
import { getToken } from "./auth/tokens.js";
import { PairingScreen } from "./auth/PairingScreen.js";
import { ChatScreen } from "./chat/ChatScreen.js";
import { RulesScreen } from "./rules/RulesScreen.js";
import { MemoryScreen } from "./memory/MemoryScreen.js";
import { SelfScreen } from "./self/SelfScreen.js";
import { OrbitScreen } from "./orbit/OrbitScreen.js";
import { ChatListScreen } from "./orbit/ChatListScreen.js";
import { VoiceScreen } from "./voice/VoiceScreen.js";
import { Splash } from "./splash/Splash.js";
import { GlassFilter } from "./components/ava/GlassFilter.js";

type View =
  | { name: "splash" }
  | { name: "orbit" }
  | { name: "chat"; sessionId: string | null; initialText?: string }
  | { name: "voice"; from: "orbit" | "chat"; sessionId: string | null }
  | { name: "memory" }
  | { name: "rules" }
  | { name: "self" }
  | { name: "list" };

export function App() {
  const [paired, setPaired] = useState<boolean>(!!getToken());
  const [view, setView] = useState<View>({ name: "splash" });

  // GSAP Flip: the orb (shared `flipId="ava-orb"`) flies between surfaces —
  // splash → home hero → chat header avatar → voice hero — instead of cutting.
  // Best-effort: matches the single orb carrying the flip id across the DOM swap;
  // if it's absent (panels) or motion is reduced, it simply doesn't animate.
  const reduced = useReducedMotion();
  const flipStateRef = useRef<ReturnType<typeof Flip.getState> | null>(null);
  useLayoutEffect(() => {
    // Only Flip between surfaces that actually own the orb. Panels (memory /
    // rules / self / list) have no orb, so running Flip during those transitions
    // would hijack the *exiting* home orb. Reduced motion: skip entirely.
    const VIEWS_WITH_ORB = ["splash", "orbit", "chat", "voice"];
    if (reduced || !VIEWS_WITH_ORB.includes(view.name)) {
      flipStateRef.current = null;
      return;
    }
    const orb = document.querySelector("[data-flip-id='ava-orb']");
    if (!orb) {
      flipStateRef.current = null;
      return;
    }
    if (flipStateRef.current) {
      try {
        Flip.from(flipStateRef.current, { duration: 0.55, ease: "power2.inOut", absolute: true, scale: true });
      } catch { /* degrade to no animation */ }
    }
    try { flipStateRef.current = Flip.getState(orb); } catch { flipStateRef.current = null; }
  }, [view.name, reduced]);

  // Persistent deck nav — the bar stays put while panels swap, tracks the current
  // view, and lets you jump straight between Home / Chats / Memory / Rules / Self.
  const navItems: TubelightItem[] = [
    { name: "Home", icon: Home, onSelect: () => setView({ name: "orbit" }) },
    { name: "New", icon: Plus, onSelect: () => setView({ name: "chat", sessionId: null }) },
    { name: "Chats", icon: List, onSelect: () => setView({ name: "list" }) },
    { name: "Memory", icon: Brain, onSelect: () => setView({ name: "memory" }) },
    { name: "Rules", icon: Settings2, onSelect: () => setView({ name: "rules" }) },
    { name: "Self", icon: Sparkles, onSelect: () => setView({ name: "self" }) },
  ];
  const NAV_FOR_VIEW: Record<string, string> = {
    orbit: "Home", memory: "Memory", rules: "Rules", self: "Self", list: "Chats",
  };
  const showNav = view.name in NAV_FOR_VIEW;

  if (!paired) return <PairingScreen onPaired={() => setPaired(true)} />;

  return (
    <div className="relative w-full h-full bg-black text-white">
      <GlassFilter />
      {/* No mode="wait": the home/voice screens have infinite CSS animations
          (nebula drift, orb morph) that never "finish", so mode="wait" would
          wait forever for exit-complete and never mount the next view (panels
          appeared dead/black). Default concurrent mode cross-fades cleanly. */}
      <AnimatePresence>
        {view.name === "splash" && (
          <motion.div
            key="splash"
            className="absolute inset-0"
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
          >
            <Splash onDone={() => setView({ name: "orbit" })} />
          </motion.div>
        )}
        {view.name === "orbit" && (
          <motion.div
            key="orbit"
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.04 }}
            transition={{ duration: 0.45, ease: [0.4, 0, 0.2, 1] }}
          >
            <OrbitScreen
              onCommand={(text) => setView({ name: "chat", sessionId: null, initialText: text })}
              onEnterVoice={() => setView({ name: "voice", from: "orbit", sessionId: null })}
            />
          </motion.div>
        )}
        {view.name === "chat" && (
          <motion.div
            key={`chat-${view.sessionId ?? "new"}`}
            className="absolute inset-0"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.45, ease: [0.4, 0, 0.2, 1] }}
          >
            <ChatScreen
              sessionId={view.sessionId}
              initialText={view.initialText}
              onOpenSessions={() => setView({ name: "orbit" })}
              onOpenRules={() => setView({ name: "rules" })}
              onOpenMemory={() => setView({ name: "memory" })}
              onOpenList={() => setView({ name: "list" })}
              onEnterVoice={() => setView({ name: "voice", from: "chat", sessionId: view.sessionId })}
            />
          </motion.div>
        )}
        {view.name === "voice" && (
          <motion.div
            key="voice"
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
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
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.985, filter: "blur(6px)" }}
            transition={{ duration: reduced ? 0.15 : 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            <MemoryScreen onClose={() => setView({ name: "orbit" })} />
          </motion.div>
        )}
        {view.name === "rules" && (
          <motion.div
            key="rules"
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.985, filter: "blur(6px)" }}
            transition={{ duration: reduced ? 0.15 : 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            <RulesScreen onClose={() => setView({ name: "orbit" })} />
          </motion.div>
        )}
        {view.name === "self" && (
          <motion.div
            key="self"
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.985, filter: "blur(6px)" }}
            transition={{ duration: reduced ? 0.15 : 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            <SelfScreen onClose={() => setView({ name: "orbit" })} />
          </motion.div>
        )}
        {view.name === "list" && (
          <motion.div
            key="list"
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.985, filter: "blur(6px)" }}
            transition={{ duration: reduced ? 0.15 : 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            <ChatListScreen
              onClose={() => setView({ name: "orbit" })}
              onOpenChat={(sid) => setView({ name: "chat", sessionId: sid })}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Persistent deck nav: stays mounted (so the cyan lamp springs smoothly
          between panels) and fades out on the immersive views (splash/chat/voice). */}
      <motion.div
        className="absolute left-1/2 top-6 z-30 -translate-x-1/2"
        animate={{ opacity: showNav ? 1 : 0, y: showNav ? 0 : -14 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        style={{ pointerEvents: showNav ? "auto" : "none" }}
      >
        <TubelightNav items={navItems} activeName={NAV_FOR_VIEW[view.name]} />
      </motion.div>
    </div>
  );
}
