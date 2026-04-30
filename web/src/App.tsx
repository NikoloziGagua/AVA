import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { getToken } from "./auth/tokens.js";
import { PairingScreen } from "./auth/PairingScreen.js";
import { ChatScreen } from "./chat/ChatScreen.js";
import { RulesScreen } from "./rules/RulesScreen.js";
import { MemoryScreen } from "./memory/MemoryScreen.js";
import { OrbitScreen } from "./orbit/OrbitScreen.js";
import { VoiceScreen } from "./voice/VoiceScreen.js";
import { GlassFilter } from "./components/ava/GlassFilter.js";

type View =
  | { name: "orbit" }
  | { name: "chat"; sessionId: string | null }
  | { name: "voice"; from: "orbit" | "chat"; sessionId: string | null }
  | { name: "memory" }
  | { name: "rules" };

export function App() {
  const [paired, setPaired] = useState<boolean>(!!getToken());
  const [view, setView] = useState<View>({ name: "orbit" });

  if (!paired) return <PairingScreen onPaired={() => setPaired(true)} />;

  return (
    <div className="relative w-full h-full bg-black text-white">
      <GlassFilter />
      <AnimatePresence mode="wait">
        {view.name === "orbit" && (
          <motion.div
            key="orbit"
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.4 }}
            transition={{ duration: 0.3 }}
          >
            <OrbitScreen
              onOpenChat={(sessionId) => setView({ name: "chat", sessionId })}
              onOpenMemory={() => setView({ name: "memory" })}
              onOpenRules={() => setView({ name: "rules" })}
              onEnterVoice={() => setView({ name: "voice", from: "orbit", sessionId: null })}
            />
          </motion.div>
        )}
        {view.name === "chat" && (
          <motion.div
            key={`chat-${view.sessionId ?? "new"}`}
            className="absolute inset-0"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <ChatScreen
              sessionId={view.sessionId}
              onOpenSessions={() => setView({ name: "orbit" })}
              onOpenRules={() => setView({ name: "rules" })}
              onOpenMemory={() => setView({ name: "memory" })}
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
            className="absolute inset-0 bg-black"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            <MemoryScreen onClose={() => setView({ name: "orbit" })} />
          </motion.div>
        )}
        {view.name === "rules" && (
          <motion.div
            key="rules"
            className="absolute inset-0 bg-black"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            <RulesScreen onClose={() => setView({ name: "orbit" })} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
